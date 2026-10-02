import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { authenticate } from './lib/auth.js';
import { AppError } from './lib/errors.js';
import { nowNs, elapsedMs, roundMs } from './lib/timing.js';
import { transactionRoutes } from './routes/transactions.js';
import { catalogRoutes } from './routes/catalog.js';
import { stockRoutes } from './routes/stock.js';
import { pool } from './lib/db.js';
import { config } from './config.js';

export async function buildApp(){
 const app=Fastify({logger:{level:process.env.LOG_LEVEL||'info'},trustProxy:true,requestTimeout:10000});
 await app.register(cors,{origin:true,credentials:false}); await app.register(helmet,{contentSecurityPolicy:false});
 app.addHook('onRequest',async(request,reply)=>{request.perfStart=nowNs(); if(request.url==='/healthz'||request.url==='/readyz')return; request.user=await authenticate(request);});
 app.addHook('onSend',async(request,reply,payload)=>{if(request.perfStart){const ms=roundMs(elapsedMs(request.perfStart));reply.header('server-timing',`app;dur=${ms}`);reply.header('x-modaviet-server-ms',String(ms));} return payload;});
 app.get('/healthz',async()=>({ok:true,service:'modaviet-kho-npl-v2',targetP95Ms:config.performanceTargetP95Ms}));
 app.get('/readyz',async()=>{await pool.query('SELECT 1');return{ok:true};});
 await app.register(catalogRoutes); await app.register(stockRoutes); await app.register(transactionRoutes);
 app.setErrorHandler((err,request,reply)=>{request.log.error(err); if(err?.name==='ZodError')return reply.code(400).send({ok:false,error:{code:'VALIDATION_ERROR',message:'Dữ liệu gửi lên không hợp lệ',details:err.issues}}); if(err instanceof AppError)return reply.code(err.statusCode).send({ok:false,error:{code:err.code,message:err.message,details:err.details}}); return reply.code(500).send({ok:false,error:{code:'INTERNAL_ERROR',message:'Lỗi hệ thống'}});});
 return app;
}
