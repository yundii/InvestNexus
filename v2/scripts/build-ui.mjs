import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  stdin: {
    contents:
      "import React from 'react'; import {createRoot} from 'react-dom/client'; import Platform from '../client/src/platform/Platform.jsx'; createRoot(document.getElementById('root')).render(React.createElement(Platform));",
    resolveDir: root,
    loader: "jsx",
  },
  bundle: true,
  minify: true,
  format: "esm",
  outfile: root + "public/app.js",
  nodePaths: [root + "node_modules"],
  alias: {
    react: root + "node_modules/react",
    "react-dom": root + "node_modules/react-dom",
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
console.log("Shared React workspaces built.");
