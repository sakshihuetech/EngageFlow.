import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
export const API_CAMPAIGN_QUEUE_NAME='whatsapp-api-campaign-send';
export interface ApiCampaignJobData { executionId:string; retrySequence?:number }
let connection:Redis|undefined; let queue:Queue<ApiCampaignJobData>|undefined; let worker:Worker<ApiCampaignJobData>|undefined;
function redis(){ if(!env.REDIS_URL.trim()) throw new Error('Redis is not configured.'); if(env.NODE_ENV==='test') throw new Error('Real Redis is disabled during tests.'); connection ??= new Redis(env.REDIS_URL,{maxRetriesPerRequest:null,enableReadyCheck:true,lazyConnect:true,connectTimeout:5000}); return connection; }
async function ready(){const r=redis(); if(r.status==='wait') await r.connect(); if(r.status!=='ready') throw new Error('Redis is unavailable.'); await r.ping(); return r;}
export const apiCampaignRedis=ready;
export async function apiCampaignQueueCounts(){queue??=new Queue(API_CAMPAIGN_QUEUE_NAME,{connection:await ready()});return queue.getJobCounts('waiting','active','delayed','failed');}
export const apiCampaignJobId=(id:string, retrySequence=0)=>`api-campaign-execution-${id}${retrySequence ? `-retry-${retrySequence}` : ''}`;
export function apiCampaignJobOptions(id:string,retrySequence=0,delay=0){return {jobId:apiCampaignJobId(id,retrySequence),...(delay>0?{delay:Math.max(0,delay)}:{}),attempts:1,removeOnComplete:{age:86400,count:5000},removeOnFail:{age:604800,count:10000}};}
export async function enqueueApiCampaignExecution(data:ApiCampaignJobData,delay=0){queue??=new Queue(API_CAMPAIGN_QUEUE_NAME,{connection:await ready()}); return queue.add('send',data,apiCampaignJobOptions(data.executionId,data.retrySequence??0,delay));}
export async function startApiCampaignWorker(processor:(job:Job<ApiCampaignJobData>)=>Promise<unknown>){if(worker)return worker; worker=new Worker(API_CAMPAIGN_QUEUE_NAME,processor,{connection:await ready(),concurrency:env.API_CAMPAIGN_WORKER_CONCURRENCY}); worker.on('error',()=>logger.error('API Campaign worker queue error')); worker.on('failed',j=>logger.error('API Campaign job failed',{jobId:j?.id??'unknown'})); return worker;}
export async function closeApiCampaignQueue(){await worker?.close().catch(()=>undefined); await queue?.close().catch(()=>undefined); await connection?.quit().catch(()=>connection?.disconnect()); worker=undefined;queue=undefined;connection=undefined;}
