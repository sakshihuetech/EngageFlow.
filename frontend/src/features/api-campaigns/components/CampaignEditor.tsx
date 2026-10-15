import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';import { Input } from '../../../components/ui/Input';import { ModalShell } from '../../../components/ui/ModalShell';import { Select } from '../../../components/ui/Select';import { apiCampaignsApi } from '../api';import type { ApiCampaign, CampaignOptions } from '../types';

export function CampaignEditor(props:{open:boolean;campaign?:ApiCampaign;onClose:()=>void;onSaved:(campaign:ApiCampaign)=>void}){
  if(!props.open)return null;
  return <CampaignEditorForm key={props.campaign?.id??'new'} {...props}/>;
}
function CampaignEditorForm({campaign,onClose,onSaved}:{open:boolean;campaign?:ApiCampaign;onClose:()=>void;onSaved:(campaign:ApiCampaign)=>void}){
  const [confirmSenderChange, setConfirmSenderChange] = useState(false);
  const[options,setOptions]=useState<CampaignOptions>();const[name,setName]=useState(campaign?.name??'');const[description,setDescription]=useState(campaign?.description??'');const[slug,setSlug]=useState(campaign?.slug??'');const[account,setAccount]=useState(campaign?.whatsappAccountId??'');const[phone,setPhone]=useState(campaign?.whatsappPhoneNumberId??'');const[template,setTemplate]=useState(campaign?.templateId??'');const[parameterSchema,setParameterSchema]=useState(campaign?.templateParameterSchema??[]);const[confirmSlugChange,setConfirmSlugChange]=useState(false);const[error,setError]=useState('');const[saving,setSaving]=useState(false);
  useEffect(()=>{let active=true;void apiCampaignsApi.options().then((value)=>{if(active){setOptions(value);if(!campaign)setAccount(value.accounts[0]?.id??'')}}).catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:'Options could not be loaded.')});return()=>{active=false}},[campaign]);
  const phones=useMemo(()=>options?.phones.filter((item)=>item.accountId===account)??[],[account,options]);const templates=useMemo(()=>options?.templates.filter((item)=>item.accountId===account)??[],[account,options]);const slugChanged=Boolean(campaign&&slug!==campaign.slug);const selectedTemplate=templates.find((item)=>item.id===template);const expectedParameters=selectedTemplate?.parameterCount??parameterSchema.length;
  const senderChanged = Boolean(campaign && (account !== campaign.whatsappAccountId || phone !== campaign.whatsappPhoneNumberId));
  const chooseTemplate=(id:string)=>{setTemplate(id);const count=templates.find((item)=>item.id===id)?.parameterCount??0;setParameterSchema(Array.from({length:count},(_,index)=>({position:index+1,name:`parameter_${index+1}`})))};
  const updateParameter=(index:number,field:'name'|'example',value:string)=>setParameterSchema((rows)=>rows.map((row,position)=>position===index?{...row,[field]:value}:row));
  const save=async()=>{setSaving(true);setError('');try{const body={name:name.trim(),description:description.trim(),slug:slug.trim(),whatsappAccountId:account,whatsappPhoneNumberId:phone,templateId:template,templateParameterSchema:parameterSchema,...(campaign?{confirmSlugChange,confirmSenderChange}:{})};onSaved(campaign?await apiCampaignsApi.update(campaign.id,body):await apiCampaignsApi.create(body))}catch(reason){setError(reason instanceof Error?reason.message:'Campaign could not be saved.')}finally{setSaving(false)}};
  return (
    <ModalShell
      open
      scrollable
      size="wide"
      title={campaign ? 'Edit API Campaign' : 'Create API Campaign'}
      description="Define the endpoint and bind it to an approved WhatsApp template."
      onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving || !name.trim() || !slug.trim() || !phone || !template || parameterSchema.length !== expectedParameters || (slugChanged && !confirmSlugChange) || (senderChanged && !confirmSenderChange)} onClick={() => void save()}>{saving ? 'Saving…' : campaign ? 'Save changes' : 'Create Campaign'}</Button></div>}
    >
      <div className="space-y-4">
        <section className="space-y-3" aria-labelledby="campaign-details-heading">
          <h3 id="campaign-details-heading" className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Campaign Details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Stable slug"><Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="payment_success" /></Field>
          </div>
          <Field label="Description"><Input value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></Field>
          {slugChanged ? <label className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning"><input type="checkbox" checked={confirmSlugChange} onChange={(event) => setConfirmSlugChange(event.target.checked)} /><span>I understand changing the slug breaks existing integrations.</span></label> : null}
        </section>
        <section className="space-y-3 border-t border-border/80 pt-4" aria-labelledby="whatsapp-configuration-heading">
          <h3 id="whatsapp-configuration-heading" className="text-xs font-semibold uppercase tracking-wide text-text-secondary">WhatsApp Configuration</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="WhatsApp account"><Select value={account} onChange={(event) => { setAccount(event.target.value); setPhone(''); chooseTemplate(''); }}><option value="">Select account</option>{options?.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Sending phone"><Select value={phone} onChange={(event) => setPhone(event.target.value)}><option value="">Select phone</option>{phones.map((item) => <option key={item.id} value={item.id}>{item.label}{item.sendReady ? '' : ' (not send-ready)'}</option>)}</Select></Field>
          </div>
          <Field label="Approved template"><Select value={template} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Select template</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</Select></Field>
          {selectedTemplate?.mediaType ? <p className="rounded-xl bg-background-subtle p-3 text-xs text-text-secondary">This template requires a {selectedTemplate.mediaType.toLowerCase()} URL in each trigger request.</p> : null}
          {senderChanged ? <label className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning"><input type="checkbox" checked={confirmSenderChange} onChange={(event) => setConfirmSenderChange(event.target.checked)} /><span>I confirm this campaign should use the newly selected sender. Existing integrations and consent must be reviewed before going live.</span></label> : null}
          {expectedParameters > 0 ? <div className="space-y-3 rounded-xl border border-border p-3"><p className="text-sm font-semibold">Template body parameters</p>{parameterSchema.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-2"><Input aria-label={`Parameter ${index + 1} name`} value={row.name} maxLength={80} onChange={(event) => updateParameter(index, 'name', event.target.value)} placeholder={`Parameter ${index + 1} name`} /><Input aria-label={`Parameter ${index + 1} example`} value={row.example ?? ''} maxLength={200} onChange={(event) => updateParameter(index, 'example', event.target.value)} placeholder="Example (optional)" /></div>)}</div> : null}
        </section>
        {error ? <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      </div>
    </ModalShell>
  );
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block text-[13px] font-semibold"><span className="mb-1.5 block">{label}</span>{children}</label>}
