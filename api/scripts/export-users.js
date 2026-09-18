import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {writeFile} from 'node:fs/promises';
const path=process.argv[2];if(!path)throw new Error('Provide a private output file path outside the repository');
const prisma=new PrismaClient();
try{const users=await prisma.user.findMany({select:{id:true,email:true,userName:true,password:true}});await writeFile(path,JSON.stringify(users),{mode:0o600,flag:'wx'});console.log('Export completed. Keep this file private: it contains credential hashes.');}finally{await prisma.$disconnect();}
