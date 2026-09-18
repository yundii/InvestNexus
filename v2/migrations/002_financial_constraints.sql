ALTER TABLE orders ADD CONSTRAINT order_payload_consistency CHECK (
 payload->>'id'=id::text AND payload->>'symbol'=symbol AND payload->>'side'=side
 AND (payload->>'quantity')::integer=quantity AND (payload->>'filled')::integer=filled AND payload->>'status'=status
 AND payload->>'orderType' IN ('MARKET','LIMIT')
 AND (payload->>'orderType'!='LIMIT' OR (payload->>'limitPrice')::bigint>0)
);
ALTER TABLE trades ADD CONSTRAINT trade_payload_consistency CHECK (
 payload->>'id'=id::text AND payload->>'orderId'=order_id::text
 AND (payload->>'quantity')::integer=quantity AND (payload->>'price')::bigint=price_cents
 AND (payload->>'fee')::bigint>=0
);
CREATE FUNCTION validate_trade_postings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 tid uuid; settlement_status text; t trades%ROWTYPE; o orders%ROWTYPE;
 posting_count integer; fee_count integer; security_count integer;
BEGIN
 tid:=NEW.trade_id;
 IF tid IS NULL THEN RETURN NULL; END IF;
 SELECT status INTO settlement_status FROM settlements WHERE trade_id=tid;
 SELECT * INTO t FROM trades WHERE id=tid;
 SELECT * INTO o FROM orders WHERE id=t.order_id;
 SELECT count(*),
   count(*) FILTER (WHERE type='FEE' AND cash_cents=-(t.payload->>'fee')::bigint),
   count(*) FILTER (WHERE type=o.side AND symbol=o.symbol
     AND quantity=CASE WHEN o.side='BUY' THEN t.quantity ELSE -t.quantity END
     AND cash_cents=CASE WHEN o.side='BUY' THEN -t.quantity*t.price_cents ELSE t.quantity*t.price_cents END)
 INTO posting_count,fee_count,security_count FROM ledger_entries WHERE trade_id=tid;
 IF settlement_status='SETTLED' AND (posting_count!=2 OR fee_count!=1 OR security_count!=1) THEN
   RAISE EXCEPTION 'Settled trade must have exactly matching security and fee postings';
 END IF;
 IF settlement_status!='SETTLED' AND posting_count!=0 THEN
   RAISE EXCEPTION 'Unsettled trade cannot have ledger postings';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER settlement_complete_postings AFTER INSERT OR UPDATE ON settlements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_trade_postings();
CREATE CONSTRAINT TRIGGER ledger_requires_settlement AFTER INSERT ON ledger_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_trade_postings();
