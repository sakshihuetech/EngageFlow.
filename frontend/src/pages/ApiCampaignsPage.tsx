import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingState } from '../components/common/LoadingState';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { StatusBadge } from '../components/ui/StatusBadge';
import { apiCampaignsApi } from '../features/api-campaigns/api';
import { CampaignEditor } from '../features/api-campaigns/components/CampaignEditor';
import type { ApiCampaign } from '../features/api-campaigns/types';
import { AccountViewPicker, useAccountScope } from '../features/whatsapp/account-view';

export function ApiCampaignsPage(){
  const {scope,select,historical,query}=useAccountScope();
  const[items,setItems]=useState<ApiCampaign[]>([]);const[error,setError]=useState('');const[loading,setLoading]=useState(true);const[open,setOpen]=useState(false);const[status,setStatus]=useState('');const[cursor,setCursor]=useState<string>();const[history,setHistory]=useState<Array<string|undefined>>([]);const[next,setNext]=useState<string|null>(null);
  const load=useCallback(async()=>{setLoading(true);setError('');try{const params=`${status?`&status=${status}`:''}${cursor?`&cursor=${cursor}`:''}${status==='ARCHIVED'?'&archived=true':''}`;const page=await apiCampaignsApi.list(params,scope);setItems(page.items);setNext(page.nextCursor)}catch(reason){setError(reason instanceof Error?reason.message:'Campaigns could not be loaded.')}finally{setLoading(false)}},[cursor,status,scope]);
  useEffect(()=>{void load()},[load]);
  return <div className="space-y-5">
    <AccountViewPicker scope={scope} onSelect={(value)=>{setCursor(undefined);setHistory([]);select(value)}}/>
    <div className="flex justify-end">{!historical?<Button onClick={()=>setOpen(true)}><Plus className="size-4"/>Create Campaign</Button>:null}</div>
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4 sm:px-5"><Select className="sm:w-52" value={status} onChange={(event)=>{setStatus(event.target.value);setCursor(undefined);setHistory([])}}><option value="">All campaigns</option>{['DRAFT','LIVE','PAUSED','ARCHIVED'].map((value)=><option key={value}>{value}</option>)}</Select></div>
      {error?<ErrorState message={error} onRetry={()=>void load()}/>:loading?<LoadingState label="Loading API campaigns"/>:!items.length?<EmptyState title="No API campaigns" description="No campaigns belong to this WABA view."/>:<div className="overflow-x-auto"><table className="campaign-table w-full min-w-[760px] text-left text-[13px]"><thead className="border-b border-border/80"><tr><th className="px-5 py-3.5">Campaign</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Template</th><th className="px-5 py-3.5">Triggers</th><th className="px-5 py-3.5">Updated</th></tr></thead><tbody className="divide-y divide-border/70">{items.map((item)=><tr key={item.id}><td className="px-5 py-4"><Link className="rounded font-semibold text-text-primary transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" to={`/developer/api-campaigns/${item.id}${query}`}>{item.name}</Link><p className="mt-1 font-mono text-xs text-text-muted">{item.slug}</p></td><td className="px-5 py-4"><StatusBadge status={item.status}/></td><td className="px-5 py-4 text-text-secondary">{item.templateSnapshot.name??'—'}</td><td className="px-5 py-4 tabular-nums font-medium text-text-primary">{item.triggerCount}</td><td className="px-5 py-4 text-xs text-text-secondary">{new Date(item.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div>}
      <div className="flex justify-end gap-2 border-t border-border p-3"><Button size="sm" variant="secondary" disabled={!history.length} onClick={()=>{const copy=[...history];setCursor(copy.pop());setHistory(copy)}}><ChevronLeft className="size-4"/>Previous</Button><Button size="sm" variant="secondary" disabled={!next} onClick={()=>{if(next){setHistory((value)=>[...value,cursor]);setCursor(next)}}}>Next<ChevronRight className="size-4"/></Button></div>
    </Card>
    <CampaignEditor open={open&&!historical} onClose={()=>setOpen(false)} onSaved={()=>{setOpen(false);void load()}}/>
  </div>;
}
