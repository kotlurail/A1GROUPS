import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  StyleSheet, Platform, Alert, Dimensions, SafeAreaView, KeyboardAvoidingView, StatusBar,
} from 'react-native';
import { useColorScheme } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { inventoryApi, rentalsApi } from '../../lib/api';

const W = Dimensions.get('window').width;
const TODAY = '2026-05-14';

// ─── Types ────────────────────────────────────────────────────────────────────
type AppView  = 'dashboard' | 'rentals' | 'stock' | 'inventory';
type ReturnSt = 'pending' | 'partial' | 'returned';
type ItemCond = 'Good' | 'Fair' | 'Damaged';
type SortKey  = 'latest' | 'oldest' | 'pending' | 'returned' | 'amount-desc' | 'venue';

interface InvItem {
  id: string; name: string; category: string; venue: string;
  totalQty: number; rentalPrice: number; purchasePrice: number; notes: string;
}
interface RentalItem {
  _id?: string;
  itemId: string; itemName: string; venue: string;
  qtyGiven: number; pricePerItem: number;
  returnStatus: ReturnSt; qtyReturned: number;
  returnCond: ItemCond; damageNotes: string; penalty: number; returnDate: string;
}
interface RentalEntry {
  id: string; customerName: string; mobile: string;
  eventName: string; eventType: string; eventDate: string;
  venueLocation: string; returnDate: string; comments: string;
  items: RentalItem[]; createdAt: string;
}
interface RIForm {
  itemId: string; itemName: string; venue: string;
  qtyGiven: string; pricePerItem: string;
  returnStatus: ReturnSt; qtyReturned: string;
  returnCond: ItemCond; damageNotes: string; penalty: string; returnDate: string;
}
interface RentalForm {
  customerName: string; mobile: string; eventName: string;
  eventType: string; eventDate: string; venueLocation: string;
  returnDate: string; comments: string; items: RIForm[];
}
interface InvForm {
  name: string; category: string; venue: string;
  totalQty: string; rentalPrice: string; purchasePrice: string; notes: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const VENUES      = ['A1 Grand', 'A1 Function Hall', 'A1 Events & Decors'];
const EVENT_TYPES = ['Wedding','Reception','Engagement','Birthday','Half Saree','Dhoti Ceremony','Haldi','Sangeeth','Corporate Event','Others'];
const CATEGORIES  = ['Seating','Tables','Decor','Lighting','Linen','Equipment','Crockery','Others'];
const CONDITIONS: ItemCond[]  = ['Good','Fair','Damaged'];
const RETURN_STS: ReturnSt[]  = ['pending','partial','returned'];
interface InvPreset { name:string; category:string; rentalPrice:string; }
const INV_PRESETS: InvPreset[] = [
  {name:'Chairs',          category:'Seating',   rentalPrice:'10'},
  {name:'Sofas',           category:'Seating',   rentalPrice:'100'},
  {name:'Benches',         category:'Seating',   rentalPrice:'30'},
  {name:'Tables',          category:'Tables',    rentalPrice:'150'},
  {name:'Dining Tables',   category:'Tables',    rentalPrice:'200'},
  {name:'Center Tables',   category:'Tables',    rentalPrice:'120'},
  {name:'Flower Arch',     category:'Decor',     rentalPrice:'500'},
  {name:'Stage Backdrop',  category:'Decor',     rentalPrice:'1000'},
  {name:'Canopy',          category:'Decor',     rentalPrice:'800'},
  {name:'LED Lights',      category:'Lighting',  rentalPrice:'300'},
  {name:'Fairy Lights',    category:'Lighting',  rentalPrice:'50'},
  {name:'Spotlights',      category:'Lighting',  rentalPrice:'200'},
  {name:'Table Cloths',    category:'Linen',     rentalPrice:'20'},
  {name:'Chair Covers',    category:'Linen',     rentalPrice:'15'},
  {name:'Table Runners',   category:'Linen',     rentalPrice:'25'},
  {name:'Sound System',    category:'Equipment', rentalPrice:'2000'},
  {name:'Generator',       category:'Equipment', rentalPrice:'1500'},
  {name:'Projector',       category:'Equipment', rentalPrice:'800'},
  {name:'Dinner Plates',   category:'Crockery',  rentalPrice:'5'},
  {name:'Glasses',         category:'Crockery',  rentalPrice:'3'},
  {name:'Serving Bowls',   category:'Crockery',  rentalPrice:'10'},
];

const SORT_OPTS: {key:SortKey;label:string;icon:string}[] = [
  {key:'latest',      label:'Latest First',    icon:'🕐'},
  {key:'oldest',      label:'Oldest First',    icon:'🕰'},
  {key:'pending',     label:'Pending Returns', icon:'⏳'},
  {key:'returned',    label:'Fully Returned',  icon:'✅'},
  {key:'amount-desc', label:'Highest Amount',  icon:'💰'},
  {key:'venue',       label:'Venue Wise',      icon:'🏛'},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n: number) => '₹' + n.toLocaleString('en-IN');

function entryTotal(e: RentalEntry): number {
  return e.items.reduce((s, i) => s + i.qtyGiven * i.pricePerItem + i.penalty, 0);
}
function entryStatus(e: RentalEntry): ReturnSt {
  if (e.items.every(i => i.returnStatus === 'returned')) return 'returned';
  if (e.items.every(i => i.returnStatus === 'pending'))  return 'pending';
  return 'partial';
}
function calcAvail(itemId: string, inv: InvItem[], entries: RentalEntry[], skipId?: string): number {
  const item = inv.find(i => i.id === itemId);
  if (!item) return 0;
  const inUse = entries.filter(e => e.id !== skipId)
    .reduce((s, e) => s + e.items.filter(r => r.itemId === itemId)
      .reduce((ss, r) => ss + Math.max(0, r.qtyGiven - r.qtyReturned), 0), 0);
  return Math.max(0, item.totalQty - inUse);
}

function normalizeRental(e:any): RentalEntry {
  return {
    ...e,
    id: e._id ?? e.id,
    items: (e.items ?? []).map((r:any) => ({
      ...r,
      itemId: r.itemId && typeof r.itemId === 'object' ? String(r.itemId._id) : String(r.itemId ?? ''),
    })),
  };
}

const emptyRI = (): RIForm => ({
  itemId:'', itemName:'', venue:VENUES[0], qtyGiven:'', pricePerItem:'',
  returnStatus:'pending', qtyReturned:'', returnCond:'Good', damageNotes:'', penalty:'', returnDate:'',
});
const emptyRF = (): RentalForm => ({
  customerName:'', mobile:'', eventName:'', eventType:EVENT_TYPES[0],
  eventDate:TODAY, venueLocation:VENUES[0], returnDate:'', comments:'', items:[emptyRI()],
});
const emptyIF = (): InvForm => ({
  name:'', category:CATEGORIES[0], venue:VENUES[0], totalQty:'', rentalPrice:'', purchasePrice:'', notes:'',
});

// ─── Theme ────────────────────────────────────────────────────────────────────
const LT = {bg:'#f0f4ff', card:'#ffffff', text:'#1a1a2e', sub:'#6b7280', border:'#e2e8f0', nav:'#ffffff'};
const DK = {bg:'#0d1117', card:'#161b22', text:'#e6edf3', sub:'#8b949e', border:'#30363d', nav:'#161b22'};

// ─── SelectField ──────────────────────────────────────────────────────────────
function Sel({label,value,options,onChange,isDark,ph}:{label?:string;value:string;options:string[];onChange(v:string):void;isDark:boolean;ph?:string}) {
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState('');
  const t=isDark?DK:LT;
  const fil=options.filter(o=>o.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      {label&&<Text style={[ss.label,{color:t.sub}]}>{label}</Text>}
      <TouchableOpacity style={[ss.trigger,{backgroundColor:t.card,borderColor:t.border}]} onPress={()=>{setQ('');setOpen(true);}}>
        <Text style={{color:value?t.text:t.sub,flex:1}}>{value||ph||'Select...'}</Text>
        <Text style={{color:t.sub}}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
        <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={()=>setOpen(false)}>
          <View style={[ss.selPanel,{backgroundColor:t.card,borderColor:t.border}]} onStartShouldSetResponder={()=>true}>
            <TextInput style={[ss.selSearch,{backgroundColor:t.bg,color:t.text,borderColor:t.border}]}
              placeholder="Search..." placeholderTextColor={t.sub} value={q} onChangeText={setQ} autoFocus/>
            <ScrollView style={{maxHeight:220}}>
              {fil.map(o=>(
                <TouchableOpacity key={o} style={ss.selOpt} onPress={()=>{onChange(o);setOpen(false);}}>
                  <Text style={{color:value===o?'#6C63FF':t.text,fontWeight:value===o?'700':'400'}}>{o}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─── DateField ────────────────────────────────────────────────────────────────
function DF({label,value,onChange,isDark}:{label:string;value:string;onChange(v:string):void;isDark:boolean}) {
  const t=isDark?DK:LT;
  if (Platform.OS==='web') return (
    <View style={{marginBottom:10}}>
      <Text style={[ss.label,{color:t.sub}]}>{label}</Text>
      <input type="date" value={value} onChange={e=>onChange((e.target as HTMLInputElement).value)}
        style={{padding:10,borderRadius:8,border:`1px solid ${t.border}`,backgroundColor:t.card,color:t.text,width:'100%',fontSize:14}}/>
    </View>
  );
  return (
    <View style={{marginBottom:10}}>
      <Text style={[ss.label,{color:t.sub}]}>{label}</Text>
      <TextInput style={[ss.trigger,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
        value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={t.sub}/>
    </View>
  );
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────
function SCard({title,value,sub,color,icon,isDark}:{title:string;value:string;sub:string;color:string;icon:string;isDark:boolean}) {
  const t=isDark?DK:LT;
  return (
    <View style={[ss.sCard,{backgroundColor:t.card,borderColor:t.border}]}>
      <View style={[ss.sIcon,{backgroundColor:color+'20'}]}><Text style={{fontSize:18}}>{icon}</Text></View>
      <Text style={[ss.sTitle,{color:t.sub}]}>{title}</Text>
      <Text style={[ss.sVal,{color}]}>{value}</Text>
      {!!sub&&<Text style={{color:t.sub,fontSize:10,marginTop:1}}>{sub}</Text>}
    </View>
  );
}

// ─── HBar ─────────────────────────────────────────────────────────────────────
function HBar({label,value,max,color,isDark}:{label:string;value:number;max:number;color:string;isDark:boolean}) {
  const t=isDark?DK:LT;
  const pct=max>0?(value/max)*100:0;
  return (
    <View style={{marginBottom:9}}>
      <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:3}}>
        <Text style={{color:t.text,fontSize:12}} numberOfLines={1}>{label}</Text>
        <Text style={{color,fontSize:12,fontWeight:'600'}}>{value}</Text>
      </View>
      <View style={{height:6,backgroundColor:t.border,borderRadius:3}}>
        <View style={{height:6,width:`${pct}%` as any,backgroundColor:color,borderRadius:3}}/>
      </View>
    </View>
  );
}

// ─── BarChart ─────────────────────────────────────────────────────────────────
function BChart({data,labels,colors,title,isDark}:{data:number[][];labels:string[];colors:string[];title:string;isDark:boolean}) {
  const t=isDark?DK:LT;
  const max=Math.max(...data.flat(),1);
  const H=100;
  return (
    <View style={[ss.chartCard,{backgroundColor:t.card,borderColor:t.border}]}>
      <Text style={[ss.chartTitle,{color:t.text}]}>{title}</Text>
      <View style={{flexDirection:'row',alignItems:'flex-end',height:H+18}}>
        {labels.map((lbl,li)=>(
          <View key={li} style={{flex:1,alignItems:'center'}}>
            <View style={{flexDirection:'row',alignItems:'flex-end',gap:2,height:H}}>
              {data.map((ser,si)=>(
                <View key={si} style={{flex:1,height:Math.max(2,(ser[li]/max)*H),backgroundColor:colors[si],borderRadius:3,opacity:0.85}}/>
              ))}
            </View>
            <Text style={{color:t.sub,fontSize:9,marginTop:2}} numberOfLines={1}>{lbl}</Text>
          </View>
        ))}
      </View>
      <View style={{flexDirection:'row',gap:14,marginTop:6}}>
        {colors.map((c,i)=>(
          <View key={i} style={{flexDirection:'row',alignItems:'center',gap:4}}>
            <View style={{width:9,height:9,borderRadius:2,backgroundColor:c}}/>
            <Text style={{color:t.sub,fontSize:11}}>{i===0?'Income':'Expense'}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
const SC: Record<ReturnSt,string> = {pending:'#e74c3c',partial:'#f39c12',returned:'#27ae60'};
function Badge({status}:{status:ReturnSt}) {
  return (
    <View style={{backgroundColor:SC[status]+'20',paddingHorizontal:8,paddingVertical:3,borderRadius:6}}>
      <Text style={{color:SC[status],fontSize:10,fontWeight:'700'}}>{status.charAt(0).toUpperCase()+status.slice(1)}</Text>
    </View>
  );
}

// ─── Rental Form Modal ────────────────────────────────────────────────────────
function RentalModal({visible,form,setForm,onSave,onClose,isDark,isEdit,inv,entries,editId}:{
  visible:boolean;form:RentalForm;setForm(f:RentalForm):void;onSave():void;onClose():void;
  isDark:boolean;isEdit:boolean;inv:InvItem[];entries:RentalEntry[];editId?:string;
}) {
  const t=isDark?DK:LT;
  function upRI(idx:number,patch:Partial<RIForm>) {
    const items=[...form.items]; items[idx]={...items[idx],...patch}; setForm({...form,items});
  }
  const grandTotal=form.items.reduce((s,r)=>(parseFloat(r.qtyGiven)||0)*(parseFloat(r.pricePerItem)||0)+s,0);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{width:'100%',maxHeight:'95%'}}>
          <View style={[ss.sheet,{backgroundColor:t.bg,flex:1}]}>
            <View style={{flexDirection:'row',alignItems:'center',marginBottom:14}}>
              <Text style={[ss.sheetTitle,{color:t.text}]}>{isEdit?'Edit Rental':'New Rental Entry'}</Text>
              <View style={{flex:1}}/>
              <TouchableOpacity onPress={onClose}><Text style={{color:t.sub,fontSize:22}}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}} keyboardShouldPersistTaps="handled">
              {/* Event Details */}
              <Text style={[ss.secHead,{color:t.text,borderBottomColor:t.border}]}>📋 Event Details</Text>
              <Text style={[ss.label,{color:t.sub}]}>Customer Name *</Text>
              <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
                value={form.customerName} onChangeText={v=>setForm({...form,customerName:v})} placeholder="Customer name" placeholderTextColor={t.sub}/>
              <Text style={[ss.label,{color:t.sub}]}>Mobile Number</Text>
              <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
                value={form.mobile} onChangeText={v=>setForm({...form,mobile:v})} placeholder="Mobile" placeholderTextColor={t.sub} keyboardType="phone-pad"/>
              <Text style={[ss.label,{color:t.sub}]}>Event Name *</Text>
              <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
                value={form.eventName} onChangeText={v=>setForm({...form,eventName:v})} placeholder="Event name" placeholderTextColor={t.sub}/>
              <Sel label="Event Type" value={form.eventType} options={EVENT_TYPES} onChange={v=>setForm({...form,eventType:v})} isDark={isDark}/>
              <View style={{height:10}}/>
              <View style={{flexDirection:'row',gap:8}}>
                <View style={{flex:1}}><DF label="Event Date" value={form.eventDate} onChange={v=>setForm({...form,eventDate:v})} isDark={isDark}/></View>
                <View style={{flex:1}}><DF label="Return Date" value={form.returnDate} onChange={v=>setForm({...form,returnDate:v})} isDark={isDark}/></View>
              </View>
              <Sel label="Venue Location" value={form.venueLocation} options={VENUES} onChange={v=>setForm({...form,venueLocation:v})} isDark={isDark}/>
              <View style={{height:10}}/>
              <Text style={[ss.label,{color:t.sub}]}>Comments / Notes</Text>
              <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text,height:58,textAlignVertical:'top'}]}
                value={form.comments} onChangeText={v=>setForm({...form,comments:v})} multiline placeholder="Optional..." placeholderTextColor={t.sub}/>

              {/* Items */}
              <Text style={[ss.secHead,{color:t.text,borderBottomColor:t.border,marginTop:8}]}>📦 Rental Items</Text>
              {form.items.map((ri,idx)=>{
                const selItem=inv.find(i=>i.name===ri.itemName);
                const avail=selItem?calcAvail(selItem.id,inv,entries,editId):0;
                const rowTotal=(parseFloat(ri.qtyGiven)||0)*(parseFloat(ri.pricePerItem)||0);
                return (
                  <View key={idx} style={[ss.itemRow,{backgroundColor:t.card,borderColor:t.border}]}>
                    <View style={{flexDirection:'row',alignItems:'center',marginBottom:8}}>
                      <Text style={{color:t.text,fontWeight:'700',fontSize:13}}>Item #{idx+1}</Text>
                      <View style={{flex:1}}/>
                      {form.items.length>1&&(
                        <TouchableOpacity onPress={()=>setForm({...form,items:form.items.filter((_,i)=>i!==idx)})}>
                          <Text style={{color:'#e74c3c',fontSize:18}}>🗑</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <Sel label="Item Name" value={ri.itemName}
                      options={inv.map(i=>i.name)}
                      onChange={v=>{
                        const f=inv.find(i=>i.name===v);
                        upRI(idx,{itemName:v,itemId:f?.id??'',pricePerItem:f?String(f.rentalPrice):'',venue:f?.venue??VENUES[0]});
                      }} isDark={isDark}/>
                    {selItem&&(
                      <View style={{flexDirection:'row',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                        <Text style={{color:t.sub,fontSize:11}}>📍 {selItem.venue}</Text>
                        <Text style={{color:avail<5?'#e74c3c':'#27ae60',fontSize:11,fontWeight:'700'}}>● Available: {avail}</Text>
                      </View>
                    )}
                    <View style={{flexDirection:'row',gap:8}}>
                      <View style={{flex:1}}>
                        <Text style={[ss.label,{color:t.sub}]}>Qty Given</Text>
                        <TextInput style={[ss.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                          value={ri.qtyGiven} onChangeText={v=>upRI(idx,{qtyGiven:v})} keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}/>
                      </View>
                      <View style={{flex:1}}>
                        <Text style={[ss.label,{color:t.sub}]}>Price/Item (₹)</Text>
                        <TextInput style={[ss.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                          value={ri.pricePerItem} onChangeText={v=>upRI(idx,{pricePerItem:v})} keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}/>
                      </View>
                    </View>
                    {rowTotal>0&&<Text style={{color:'#6C63FF',fontWeight:'700',fontSize:12,textAlign:'right',marginBottom:6}}>{fmt(rowTotal)}</Text>}
                    <Sel label="Condition" value={ri.returnCond} options={CONDITIONS} onChange={v=>upRI(idx,{returnCond:v as ItemCond})} isDark={isDark}/>
                    <View style={{height:4}}/>
                  </View>
                );
              })}
              <TouchableOpacity style={[ss.addItemBtn,{borderColor:'#6C63FF'}]} onPress={()=>setForm({...form,items:[...form.items,emptyRI()]})}>
                <Text style={{color:'#6C63FF',fontWeight:'700'}}>+ Add Item</Text>
              </TouchableOpacity>
              {grandTotal>0&&(
                <View style={[ss.totalBox,{backgroundColor:'#6C63FF15',borderColor:'#6C63FF40'}]}>
                  <Text style={{color:'#6C63FF',fontSize:13}}>Grand Total</Text>
                  <Text style={{color:'#6C63FF',fontSize:22,fontWeight:'800'}}>{fmt(grandTotal)}</Text>
                </View>
              )}
              <TouchableOpacity style={[ss.saveBtn,{backgroundColor:'#6C63FF'}]} onPress={onSave}>
                <Text style={ss.saveTxt}>{isEdit?'Update Rental':'Create Rental Entry'}</Text>
              </TouchableOpacity>
              <View style={{height:24}}/>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Return Modal ─────────────────────────────────────────────────────────────
function ReturnModal({entry,onClose,onUpdate,isDark}:{entry:RentalEntry|null;onClose():void;onUpdate(e:RentalEntry):void;isDark:boolean}) {
  const [items,setItems]=useState<RentalItem[]>([]);
  React.useEffect(()=>{if(entry)setItems(entry.items.map(i=>({...i})));},[entry?.id]);
  if(!entry) return null;
  const t=isDark?DK:LT;
  function upItem(idx:number,p:Partial<RentalItem>) {
    const a=[...items]; a[idx]={...a[idx],...p}; setItems(a);
  }
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{width:'100%',maxHeight:'95%'}}>
          <View style={[ss.sheet,{backgroundColor:t.bg,flex:1}]}>
            <View style={{flexDirection:'row',alignItems:'center',marginBottom:12}}>
              <View>
                <Text style={[ss.sheetTitle,{color:t.text}]}>Manage Returns</Text>
                <Text style={{color:t.sub,fontSize:12}}>{entry.customerName} · {entry.eventName}</Text>
              </View>
              <View style={{flex:1}}/>
              <TouchableOpacity onPress={onClose}><Text style={{color:t.sub,fontSize:22}}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}} keyboardShouldPersistTaps="handled">
              {items.map((ri,idx)=>{
                const pending=ri.qtyGiven-ri.qtyReturned;
                return (
                  <View key={idx} style={[ss.itemRow,{backgroundColor:t.card,borderColor:t.border}]}>
                    <Text style={{color:t.text,fontWeight:'700',marginBottom:6,fontSize:13}}>{ri.itemName}</Text>
                    <View style={{flexDirection:'row',gap:12,marginBottom:8}}>
                      <Text style={{color:t.sub,fontSize:11}}>Given: <Text style={{fontWeight:'700',color:t.text}}>{ri.qtyGiven}</Text></Text>
                      <Text style={{color:t.sub,fontSize:11}}>Returned: <Text style={{fontWeight:'700',color:'#27ae60'}}>{ri.qtyReturned}</Text></Text>
                      <Text style={{color:t.sub,fontSize:11}}>Pending: <Text style={{fontWeight:'700',color:pending>0?'#e74c3c':'#27ae60'}}>{pending}</Text></Text>
                    </View>
                    <View style={{flexDirection:'row',gap:6,marginBottom:10}}>
                      {RETURN_STS.map(rs=>(
                        <TouchableOpacity key={rs} style={{flex:1,padding:7,borderRadius:7,borderWidth:1,alignItems:'center',
                          backgroundColor:ri.returnStatus===rs?SC[rs]:'transparent',borderColor:SC[rs]}}
                          onPress={()=>{
                            let qr=ri.qtyReturned;
                            if(rs==='returned') qr=ri.qtyGiven;
                            if(rs==='pending') qr=0;
                            upItem(idx,{returnStatus:rs,qtyReturned:qr});
                          }}>
                          <Text style={{color:ri.returnStatus===rs?'#fff':SC[rs],fontSize:10,fontWeight:'700'}}>
                            {rs.charAt(0).toUpperCase()+rs.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {ri.returnStatus!=='pending'&&(
                      <>
                        <View style={{flexDirection:'row',gap:8}}>
                          <View style={{flex:1}}>
                            <Text style={[ss.label,{color:t.sub}]}>Qty Returned</Text>
                            <TextInput style={[ss.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                              value={String(ri.qtyReturned)}
                              onChangeText={v=>upItem(idx,{qtyReturned:Math.min(ri.qtyGiven,parseInt(v)||0)})}
                              keyboardType="numeric"/>
                          </View>
                          <View style={{flex:1}}>
                            <Text style={[ss.label,{color:t.sub}]}>Penalty (₹)</Text>
                            <TextInput style={[ss.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                              value={String(ri.penalty)} onChangeText={v=>upItem(idx,{penalty:parseFloat(v)||0})} keyboardType="numeric"/>
                          </View>
                        </View>
                        <Sel label="Return Condition" value={ri.returnCond} options={CONDITIONS}
                          onChange={v=>upItem(idx,{returnCond:v as ItemCond})} isDark={isDark}/>
                        <View style={{height:8}}/>
                        <Text style={[ss.label,{color:t.sub}]}>Damage Notes</Text>
                        <TextInput style={[ss.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                          value={ri.damageNotes} onChangeText={v=>upItem(idx,{damageNotes:v})}
                          placeholder="Optional..." placeholderTextColor={t.sub}/>
                      </>
                    )}
                  </View>
                );
              })}
              <TouchableOpacity style={[ss.saveBtn,{backgroundColor:'#27ae60'}]} onPress={()=>{onUpdate({...entry,items});onClose();}}>
                <Text style={ss.saveTxt}>Save Return Details</Text>
              </TouchableOpacity>
              <View style={{height:24}}/>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── View Rental Modal ────────────────────────────────────────────────────────
function ViewModal({entry,onClose,onEdit,onReturn,isDark,onPrint}:{entry:RentalEntry|null;onClose():void;onEdit():void;onReturn():void;onPrint():void;isDark:boolean}) {
  if(!entry) return null;
  const t=isDark?DK:LT;
  const total=entryTotal(entry);
  const st=entryStatus(entry);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}>
        <View style={[ss.sheet,{backgroundColor:t.bg,maxHeight:'95%'}]}>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:14}}>
            <View>
              <Text style={[ss.sheetTitle,{color:t.text}]}>{entry.eventName}</Text>
              <Text style={{color:t.sub,fontSize:12}}>{entry.customerName} · {entry.mobile}</Text>
            </View>
            <View style={{flex:1}}/>
            <TouchableOpacity onPress={onClose}><Text style={{color:t.sub,fontSize:22}}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[ss.detailBlock,{backgroundColor:SC[st]+'10',borderColor:SC[st]+'30'}]}>
              <Badge status={st}/>
              <Text style={{color:t.text,fontSize:24,fontWeight:'800',marginTop:6}}>{fmt(total)}</Text>
              <Text style={{color:t.sub,fontSize:12}}>{entry.eventType} · {entry.venueLocation}</Text>
            </View>
            {([['Event Date',entry.eventDate],['Return Date',entry.returnDate||'—'],['Venue',entry.venueLocation],
               ['Event Type',entry.eventType],['Comments',entry.comments||'—']] as [string,string][]).map(([k,v])=>(
              <View key={k} style={[ss.detRow,{borderBottomColor:t.border}]}>
                <Text style={{color:t.sub,fontSize:13,flex:1}}>{k}</Text>
                <Text style={{color:t.text,fontSize:13,flex:2,textAlign:'right'}}>{v}</Text>
              </View>
            ))}
            <Text style={[ss.secHead,{color:t.text,borderBottomColor:t.border,marginTop:10}]}>📦 Items ({entry.items.length})</Text>
            {entry.items.map((ri,i)=>(
              <View key={i} style={[ss.viewItemRow,{backgroundColor:t.card,borderColor:t.border}]}>
                <View style={{flexDirection:'row',alignItems:'center',marginBottom:4}}>
                  <Text style={{color:t.text,fontWeight:'600',flex:1,fontSize:13}}>{ri.itemName}</Text>
                  <Badge status={ri.returnStatus}/>
                </View>
                <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>
                  <Text style={{color:t.sub,fontSize:11}}>Given: <Text style={{color:t.text,fontWeight:'600'}}>{ri.qtyGiven}</Text></Text>
                  <Text style={{color:t.sub,fontSize:11}}>Returned: <Text style={{color:t.text,fontWeight:'600'}}>{ri.qtyReturned}</Text></Text>
                  <Text style={{color:t.sub,fontSize:11}}>Price: <Text style={{color:'#6C63FF',fontWeight:'600'}}>{fmt(ri.pricePerItem)}</Text></Text>
                  <Text style={{color:t.sub,fontSize:11}}>Total: <Text style={{color:'#6C63FF',fontWeight:'700'}}>{fmt(ri.qtyGiven*ri.pricePerItem)}</Text></Text>
                  {ri.penalty>0&&<Text style={{color:'#e74c3c',fontSize:11,fontWeight:'600'}}>Penalty: {fmt(ri.penalty)}</Text>}
                </View>
                {!!ri.damageNotes&&<Text style={{color:'#e74c3c',fontSize:11,marginTop:4}}>⚠ {ri.damageNotes}</Text>}
              </View>
            ))}
            <View style={{flexDirection:'row',gap:8,marginTop:14}}>
              <TouchableOpacity style={[ss.actBtn,{backgroundColor:'#27ae60'}]} onPress={onReturn}><Text style={ss.actTxt}>↩ Returns</Text></TouchableOpacity>
              <TouchableOpacity style={[ss.actBtn,{backgroundColor:'#f39c12'}]} onPress={onEdit}><Text style={ss.actTxt}>✏️ Edit</Text></TouchableOpacity>
              <TouchableOpacity style={[ss.actBtn,{backgroundColor:'#8e44ad'}]} onPress={onPrint}><Text style={ss.actTxt}>🖨 Print</Text></TouchableOpacity>
            </View>
            <View style={{height:24}}/>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Inventory Item Modal ─────────────────────────────────────────────────────
function InvModal({visible,form,setForm,onSave,onClose,isDark,isEdit}:{
  visible:boolean;form:InvForm;setForm(f:InvForm):void;onSave():void;onClose():void;isDark:boolean;isEdit:boolean;
}) {
  const t=isDark?DK:LT;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{width:'100%',maxHeight:'95%'}}>
          <View style={[ss.sheet,{backgroundColor:t.bg,flex:1}]}>
            <View style={{flexDirection:'row',alignItems:'center',marginBottom:14}}>
              <Text style={[ss.sheetTitle,{color:t.text}]}>{isEdit?'Edit Item':'Add Inventory Item'}</Text>
              <View style={{flex:1}}/>
              <TouchableOpacity onPress={onClose}><Text style={{color:t.sub,fontSize:22}}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}} keyboardShouldPersistTaps="handled">
              {!isEdit&&(
                <View style={{marginBottom:4}}>
                  <Sel label="Quick Select Item" value={form.name}
                    options={INV_PRESETS.map(p=>p.name)} ph="Choose a common item..."
                    onChange={v=>{
                      const p=INV_PRESETS.find(x=>x.name===v);
                      if(p) setForm({...form,name:p.name,category:p.category,rentalPrice:p.rentalPrice});
                    }} isDark={isDark}/>
                  <View style={{height:8}}/>
                </View>
              )}
              <Text style={[ss.label,{color:t.sub}]}>Item Name *</Text>
              <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
                value={form.name} onChangeText={v=>setForm({...form,name:v})} placeholder="Item name" placeholderTextColor={t.sub}/>
              <Sel label="Category" value={form.category} options={CATEGORIES} onChange={v=>setForm({...form,category:v})} isDark={isDark}/>
              <View style={{height:10}}/>
              <Sel label="Home Venue" value={form.venue} options={VENUES} onChange={v=>setForm({...form,venue:v})} isDark={isDark}/>
              <View style={{height:10}}/>
              <View style={{flexDirection:'row',gap:8}}>
                <View style={{flex:1}}>
                  <Text style={[ss.label,{color:t.sub}]}>Total Quantity</Text>
                  <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
                    value={form.totalQty} onChangeText={v=>setForm({...form,totalQty:v})} keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}/>
                </View>
                <View style={{flex:1}}>
                  <Text style={[ss.label,{color:t.sub}]}>Rental Price (₹)</Text>
                  <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
                    value={form.rentalPrice} onChangeText={v=>setForm({...form,rentalPrice:v})} keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}/>
                </View>
              </View>
              <Text style={[ss.label,{color:t.sub}]}>Purchase Price (₹)</Text>
              <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
                value={form.purchasePrice} onChangeText={v=>setForm({...form,purchasePrice:v})} keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}/>
              <Text style={[ss.label,{color:t.sub}]}>Notes</Text>
              <TextInput style={[ss.inp,{backgroundColor:t.card,borderColor:t.border,color:t.text,height:60,textAlignVertical:'top'}]}
                value={form.notes} onChangeText={v=>setForm({...form,notes:v})} multiline placeholder="Optional notes..." placeholderTextColor={t.sub}/>
              <TouchableOpacity style={[ss.saveBtn,{backgroundColor:'#6C63FF'}]} onPress={onSave}>
                <Text style={ss.saveTxt}>{isEdit?'Update Item':'Add Item'}</Text>
              </TouchableOpacity>
              <View style={{height:24}}/>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Sort Modal ───────────────────────────────────────────────────────────────
function SortModal({visible,current,onSelect,onClose,isDark}:{visible:boolean;current:SortKey;onSelect(k:SortKey):void;onClose():void;isDark:boolean}) {
  const t=isDark?DK:LT;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[ss.sheet,{backgroundColor:t.bg,maxHeight:380}]} onStartShouldSetResponder={()=>true}>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:14}}>
            <Text style={[ss.sheetTitle,{color:t.text}]}>Sort By</Text>
            <View style={{flex:1}}/>
            <TouchableOpacity onPress={onClose}><Text style={{color:t.sub,fontSize:22}}>✕</Text></TouchableOpacity>
          </View>
          {SORT_OPTS.map(opt=>{
            const active=current===opt.key;
            return (
              <TouchableOpacity key={opt.key}
                style={{flexDirection:'row',alignItems:'center',padding:13,borderRadius:10,marginBottom:6,borderWidth:1,
                  borderColor:active?'#6C63FF40':t.border,backgroundColor:active?'#6C63FF12':'transparent'}}
                onPress={()=>{onSelect(opt.key);onClose();}}>
                <Text style={{fontSize:17,marginRight:12}}>{opt.icon}</Text>
                <Text style={{color:active?'#6C63FF':t.text,fontWeight:active?'700':'400',fontSize:14,flex:1}}>{opt.label}</Text>
                {active&&<Text style={{color:'#6C63FF',fontSize:16}}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────
function DashboardView({entries,inv,isDark,onNewRental}:{entries:RentalEntry[];inv:InvItem[];isDark:boolean;onNewRental():void}) {
  const t=isDark?DK:LT;
  const totalStock   = inv.reduce((s,i)=>s+i.totalQty,0);
  const totalOut     = entries.reduce((s,e)=>s+e.items.reduce((ss,r)=>ss+Math.max(0,r.qtyGiven-r.qtyReturned),0),0);
  const totalReturned= entries.reduce((s,e)=>s+e.items.reduce((ss,r)=>ss+r.qtyReturned,0),0);
  const pendingCount = entries.filter(e=>entryStatus(e)!=='returned').length;
  const totalRev     = entries.reduce((s,e)=>s+entryTotal(e),0);
  const pendingItems = entries.reduce((s,e)=>s+e.items.filter(r=>r.returnStatus!=='returned').reduce((ss,r)=>ss+(r.qtyGiven-r.qtyReturned),0),0);
  const lowStock     = inv.filter(item=>calcAvail(item.id,inv,entries)<5).length;

  const YMS=['2025-12','2026-01','2026-02','2026-03','2026-04','2026-05'];
  const LBLS=['Dec','Jan','Feb','Mar','Apr','May'];
  const monthRev=YMS.map(ym=>entries.filter(e=>e.createdAt.startsWith(ym)).reduce((s,e)=>s+entryTotal(e),0));
  const monthOut=YMS.map(ym=>entries.filter(e=>e.createdAt.startsWith(ym)).reduce((s,e)=>s+e.items.reduce((ss,r)=>ss+r.qtyGiven,0),0));

  const venueStats=VENUES.map(v=>({
    v, rev:entries.filter(e=>e.venueLocation===v).reduce((s,e)=>s+entryTotal(e),0),
    out:entries.reduce((s,e)=>s+e.items.filter(r=>r.venue===v).reduce((ss,r)=>ss+Math.max(0,r.qtyGiven-r.qtyReturned),0),0),
  }));
  const maxRev=Math.max(...venueStats.map(v=>v.rev),1);

  const pendingEntries=entries.filter(e=>entryStatus(e)!=='returned').slice(0,4);
  const recentEntries=[...entries].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,3);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:100}}>
      {/* Summary Cards */}
      <View style={ss.grid}>
        <SCard title="Total Stock"     value={String(totalStock)}   sub="All items"       color="#6C63FF" icon="🗄"  isDark={isDark}/>
        <SCard title="Items Out"       value={String(totalOut)}     sub="Currently rented" color="#f39c12" icon="📤" isDark={isDark}/>
        <SCard title="Returned"        value={String(totalReturned)}sub="All time"         color="#27ae60" icon="✅" isDark={isDark}/>
        <SCard title="Pending Returns" value={String(pendingItems)} sub={`${pendingCount} entries`} color="#e74c3c" icon="⏳" isDark={isDark}/>
        <SCard title="Rental Revenue"  value={fmt(totalRev)}        sub="All time"         color="#3498db" icon="💰" isDark={isDark}/>
        <SCard title="Low Stock Alert" value={String(lowStock)}     sub="Items < 5 avail"  color="#e67e22" icon="⚠️" isDark={isDark}/>
      </View>

      {/* Quick Add */}
      <TouchableOpacity style={[ss.quickAdd,{backgroundColor:'#6C63FF'}]} onPress={onNewRental}>
        <Text style={{color:'#fff',fontWeight:'800',fontSize:15}}>+ New Rental Entry</Text>
      </TouchableOpacity>

      {/* Monthly Revenue Chart */}
      <BChart data={[monthRev,[...monthOut.map(v=>v*5)]]} labels={LBLS} colors={['#6C63FF','#27ae60']} title="Monthly Revenue Overview" isDark={isDark}/>

      {/* Venue Revenue */}
      <View style={[ss.chartCard,{backgroundColor:t.card,borderColor:t.border}]}>
        <Text style={[ss.chartTitle,{color:t.text}]}>Venue-wise Revenue</Text>
        {venueStats.map(v=>(
          <View key={v.v}>
            <HBar label={v.v} value={v.rev} max={maxRev} color="#6C63FF" isDark={isDark}/>
            <Text style={{color:t.sub,fontSize:10,marginBottom:6,marginTop:-6}}>Items currently out: {v.out}</Text>
          </View>
        ))}
      </View>

      {/* Pending Returns */}
      {pendingEntries.length>0&&(
        <View style={[ss.chartCard,{backgroundColor:t.card,borderColor:t.border}]}>
          <Text style={[ss.chartTitle,{color:t.text}]}>⏳ Pending Returns</Text>
          {pendingEntries.map(e=>(
            <View key={e.id} style={[ss.miniCard,{backgroundColor:t.bg,borderColor:t.border}]}>
              <View style={{flexDirection:'row',alignItems:'center'}}>
                <View style={{flex:1}}>
                  <Text style={{color:t.text,fontWeight:'700',fontSize:13}}>{e.eventName}</Text>
                  <Text style={{color:t.sub,fontSize:11}}>{e.customerName} · Due: {e.returnDate||'—'}</Text>
                </View>
                <Badge status={entryStatus(e)}/>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Recent Rentals */}
      <View style={[ss.chartCard,{backgroundColor:t.card,borderColor:t.border}]}>
        <Text style={[ss.chartTitle,{color:t.text}]}>🕐 Recent Rentals</Text>
        {recentEntries.map(e=>(
          <View key={e.id} style={[ss.miniCard,{backgroundColor:t.bg,borderColor:t.border}]}>
            <View style={{flexDirection:'row',alignItems:'center'}}>
              <View style={{flex:1}}>
                <Text style={{color:t.text,fontWeight:'700',fontSize:13}}>{e.eventName}</Text>
                <Text style={{color:t.sub,fontSize:11}}>{e.venueLocation} · {e.eventDate}</Text>
              </View>
              <Text style={{color:'#6C63FF',fontWeight:'700',fontSize:13}}>{fmt(entryTotal(e))}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Rentals View ─────────────────────────────────────────────────────────────
function RentalsView({entries,setEntries,inv,setInv,isDark}:{entries:RentalEntry[];setEntries:React.Dispatch<React.SetStateAction<RentalEntry[]>>;inv:InvItem[];setInv:React.Dispatch<React.SetStateAction<InvItem[]>>;isDark:boolean}) {
  const t=isDark?DK:LT;
  const [venueF,setVenueF]=useState('All');
  const [typeF,setTypeF]=useState('All');
  const [statusF,setStatusF]=useState('All');
  const [search,setSearch]=useState('');
  const [sortK,setSortK]=useState<SortKey>('latest');
  const [showSort,setShowSort]=useState(false);
  const [showForm,setShowForm]=useState(false);
  const [editEntry,setEditEntry]=useState<RentalEntry|null>(null);
  const [viewEntry,setViewEntry]=useState<RentalEntry|null>(null);
  const [returnEntry,setReturnEntry]=useState<RentalEntry|null>(null);
  const [form,setForm]=useState<RentalForm>(emptyRF());
  const [isEdit,setIsEdit]=useState(false);

  const filtered=useMemo(()=>{
    let arr=[...entries];
    if(venueF!=='All') arr=arr.filter(e=>e.venueLocation===venueF);
    if(typeF!=='All') arr=arr.filter(e=>e.eventType===typeF);
    if(statusF!=='All') arr=arr.filter(e=>entryStatus(e)===statusF);
    if(search) arr=arr.filter(e=>[e.customerName,e.eventName,e.mobile].some(f=>f.toLowerCase().includes(search.toLowerCase())));
    switch(sortK){
      case 'oldest': return arr.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      case 'pending': return arr.sort((a,b)=>entryStatus(a)==='pending'?-1:1);
      case 'returned': return arr.sort((a,b)=>entryStatus(a)==='returned'?-1:1);
      case 'amount-desc': return arr.sort((a,b)=>entryTotal(b)-entryTotal(a));
      case 'venue': return arr.sort((a,b)=>a.venueLocation.localeCompare(b.venueLocation));
      default: return arr.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    }
  },[entries,venueF,typeF,statusF,search,sortK]);

  function openAdd(){setForm(emptyRF());setIsEdit(false);setEditEntry(null);setShowForm(true);}
  function openEdit(e:RentalEntry){setForm({...e,items:e.items.map(r=>({...r,qtyGiven:String(r.qtyGiven),pricePerItem:String(r.pricePerItem),qtyReturned:String(r.qtyReturned),penalty:String(r.penalty)}))});setIsEdit(true);setEditEntry(e);setShowForm(true);}

  async function resolveItemId(r:RIForm):Promise<string>{
    if(r.itemId) return r.itemId;
    const existing=inv.find(i=>i.name===r.itemName);
    if(existing) return existing.id;
    const preset=INV_PRESETS.find(p=>p.name===r.itemName);
    const created=await inventoryApi.create({
      name:r.itemName, category:preset?.category??'Others', venue:r.venue||VENUES[0],
      totalQty:parseInt(r.qtyGiven)||1,
      rentalPrice:parseFloat(r.pricePerItem)||parseFloat(preset?.rentalPrice??'0'),
      purchasePrice:0, notes:'',
    });
    setInv(prev=>[...prev,{...created,id:created._id}]);
    return created._id;
  }

  async function handleSave(){
    if(!form.customerName||!form.eventName){
      Platform.OS==='web'?window.alert('Fill required fields.'):Alert.alert('Required','Fill customer name and event name.');
      return;
    }
    try {
      const items:RentalItem[]=await Promise.all(form.items.filter(r=>r.itemName).map(async r=>({
        itemId:await resolveItemId(r),itemName:r.itemName,venue:r.venue,
        qtyGiven:parseInt(r.qtyGiven)||0,pricePerItem:parseFloat(r.pricePerItem)||0,
        returnStatus:r.returnStatus,qtyReturned:parseInt(r.qtyReturned)||0,
        returnCond:r.returnCond,damageNotes:r.damageNotes,penalty:parseFloat(r.penalty)||0,returnDate:r.returnDate,
      })));
      const payload = {...form, items} as any;
      if(isEdit&&editEntry){
        const updated = await rentalsApi.update(editEntry.id, payload);
        setEntries(prev => prev.map(e => e.id===editEntry.id ? normalizeRental(updated) : e));
      } else {
        const created = await rentalsApi.create(payload);
        setEntries(prev => [normalizeRental(created), ...prev]);
      }
      setShowForm(false);setEditEntry(null);
    } catch(e:any){Alert.alert('Error',e.message);}
  }

  function handleDelete(id:string){
    const del=async()=>{
      try{
        await rentalsApi.remove(id);
        setEntries(prev=>prev.filter(e=>e.id!==id));
      }catch(e:any){Alert.alert('Error',e.message);}
    };
    Platform.OS==='web'?window.confirm('Delete this rental?')&&del():Alert.alert('Delete','Delete this rental?',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:del}]);
  }

  async function handlePrint(e:RentalEntry){
    const rows=e.items.map(r=>`<tr><td>${r.itemName}</td><td>${r.qtyGiven}</td><td>₹${r.pricePerItem}</td><td>₹${r.qtyGiven*r.pricePerItem}</td><td>${r.returnStatus}</td></tr>`).join('');
    const html=`<html><body style="font-family:sans-serif;padding:24px;max-width:600px">
      <h2 style="color:#6C63FF">Rental Invoice — ${e.eventName}</h2>
      <p><b>Customer:</b> ${e.customerName} | <b>Mobile:</b> ${e.mobile}</p>
      <p><b>Event Type:</b> ${e.eventType} | <b>Venue:</b> ${e.venueLocation}</p>
      <p><b>Event Date:</b> ${e.eventDate} | <b>Return Date:</b> ${e.returnDate||'—'}</p>
      <table border="1" cellpadding="8" width="100%" style="border-collapse:collapse;margin-top:12px">
        <tr style="background:#6C63FF;color:#fff"><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th>Status</th></tr>
        ${rows}
      </table>
      <p style="font-size:18px;font-weight:bold;text-align:right;margin-top:12px">Grand Total: ₹${entryTotal(e).toLocaleString('en-IN')}</p>
      ${e.comments?`<p><b>Notes:</b> ${e.comments}</p>`:''}
      <hr/><p style="color:#999;font-size:11px">Generated by A1 Groups App</p>
    </body></html>`;
    try{const{uri}=await Print.printToFileAsync({html});await Sharing.shareAsync(uri);}catch{}
  }

  return (
    <View style={{flex:1}}>
      {/* Filters */}
      <View style={{paddingHorizontal:14,paddingTop:10,paddingBottom:6}}>
        <View style={{flexDirection:'row',gap:8,marginBottom:8,alignItems:'center'}}>
          <TextInput style={[ss.searchBox,{backgroundColor:t.card,borderColor:t.border,color:t.text,flex:1}]}
            value={search} onChangeText={setSearch} placeholder="Search customer, event..." placeholderTextColor={t.sub}/>
          <TouchableOpacity style={[ss.sortBtn,{backgroundColor:sortK!=='latest'?'#6C63FF':t.card,borderColor:sortK!=='latest'?'#6C63FF':t.border}]} onPress={()=>setShowSort(true)}>
            <Text style={{color:sortK!=='latest'?'#fff':t.text,fontSize:13}}>⇅</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[ss.sortBtn,{backgroundColor:'#6C63FF',borderColor:'#6C63FF'}]} onPress={openAdd}>
            <Text style={{color:'#fff',fontSize:13,fontWeight:'700'}}>+</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:6}}>
          {['All',...VENUES].map(v=>(
            <TouchableOpacity key={v} style={[ss.fChip,{backgroundColor:venueF===v?'#6C63FF20':'transparent',borderColor:venueF===v?'#6C63FF':t.border}]} onPress={()=>setVenueF(v)}>
              <Text style={{color:venueF===v?'#6C63FF':t.sub,fontSize:11}}>{v}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(['All','pending','partial','returned'] as const).map(s=>(
            <TouchableOpacity key={s} style={[ss.fChip,{backgroundColor:statusF===s?(s==='All'?'#6C63FF20':SC[s as ReturnSt]+'20'):'transparent',borderColor:statusF===s?(s==='All'?'#6C63FF':SC[s as ReturnSt]):t.border}]}
              onPress={()=>setStatusF(s)}>
              <Text style={{color:statusF===s?(s==='All'?'#6C63FF':SC[s as ReturnSt]):t.sub,fontSize:11,fontWeight:'600'}}>
                {s==='All'?'All Status':s.charAt(0).toUpperCase()+s.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{paddingHorizontal:14,paddingBottom:100}}>
        <Text style={{color:t.sub,fontSize:12,marginBottom:8}}>{filtered.length} rental{filtered.length!==1?'s':''}</Text>
        {filtered.length===0?(
          <View style={{alignItems:'center',padding:40}}>
            <Text style={{fontSize:40}}>📋</Text>
            <Text style={{color:t.sub,marginTop:8}}>No rentals found</Text>
          </View>
        ):filtered.map(e=>{
          const st=entryStatus(e);
          const total=entryTotal(e);
          const pendQty=e.items.reduce((s,r)=>s+(r.qtyGiven-r.qtyReturned),0);
          return (
            <View key={e.id} style={[ss.rentalCard,{backgroundColor:t.card,borderColor:t.border}]}>
              <View style={{flexDirection:'row',alignItems:'flex-start',marginBottom:6}}>
                <View style={{flex:1}}>
                  <Text style={{color:t.text,fontWeight:'800',fontSize:14}}>{e.eventName}</Text>
                  <Text style={{color:t.sub,fontSize:12}}>{e.customerName} · {e.mobile}</Text>
                </View>
                <Badge status={st}/>
              </View>
              <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:8}}>
                <Text style={{color:t.sub,fontSize:11}}>📅 {e.eventDate}</Text>
                <Text style={{color:t.sub,fontSize:11}}>🏛 {e.venueLocation}</Text>
                <Text style={{color:t.sub,fontSize:11}}>🎉 {e.eventType}</Text>
                <Text style={{color:t.sub,fontSize:11}}>↩ {e.returnDate||'No return date'}</Text>
              </View>
              <View style={{flexDirection:'row',alignItems:'center',marginBottom:8}}>
                <View style={{flex:1}}>
                  <Text style={{color:t.sub,fontSize:11}}>{e.items.length} item type{e.items.length!==1?'s':''} · {e.items.reduce((s,r)=>s+r.qtyGiven,0)} units</Text>
                  {pendQty>0&&<Text style={{color:'#e74c3c',fontSize:11,fontWeight:'600'}}>⚠ {pendQty} units pending return</Text>}
                </View>
                <Text style={{color:'#6C63FF',fontSize:16,fontWeight:'800'}}>{fmt(total)}</Text>
              </View>
              <View style={{flexDirection:'row',gap:7}}>
                {[['👁','View','#3498db'],['✏️','Edit','#f39c12'],['↩','Return','#27ae60'],['🖨','Print','#8e44ad'],['🗑','Del','#e74c3c']].map(([icon,lbl,clr])=>(
                  <TouchableOpacity key={lbl} style={[ss.rowBtn,{borderColor:clr+'40'}]}
                    onPress={()=>{
                      if(lbl==='View') setViewEntry(e);
                      if(lbl==='Edit') openEdit(e);
                      if(lbl==='Return') setReturnEntry(e);
                      if(lbl==='Print') handlePrint(e);
                      if(lbl==='Del') handleDelete(e.id);
                    }}>
                    <Text style={{color:clr,fontSize:12}}>{icon}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <RentalModal visible={showForm} form={form} setForm={setForm} onSave={handleSave}
        onClose={()=>{setShowForm(false);setEditEntry(null);}} isDark={isDark} isEdit={isEdit}
        inv={inv} entries={entries} editId={editEntry?.id}/>
      <ReturnModal entry={returnEntry} onClose={()=>setReturnEntry(null)}
        onUpdate={async updated=>{
          try{await rentalsApi.update(updated.id,{...updated,items:updated.items.map((i:any)=>({...i}))});}catch{}
          setEntries(prev=>prev.map(e=>e.id===updated.id?updated:e));
        }} isDark={isDark}/>
      <ViewModal entry={viewEntry} onClose={()=>setViewEntry(null)}
        onEdit={()=>{if(viewEntry){openEdit(viewEntry);setViewEntry(null);}}}
        onReturn={()=>{if(viewEntry){setReturnEntry(viewEntry);setViewEntry(null);}}}
        onPrint={()=>{if(viewEntry)handlePrint(viewEntry);}} isDark={isDark}/>
      <SortModal visible={showSort} current={sortK} onSelect={setSortK} onClose={()=>setShowSort(false)} isDark={isDark}/>
    </View>
  );
}

// ─── Stock View ───────────────────────────────────────────────────────────────
function StockView({entries,inv,isDark}:{entries:RentalEntry[];inv:InvItem[];isDark:boolean}) {
  const t=isDark?DK:LT;
  const [catF,setCatF]=useState('All');
  const totalStock=inv.reduce((s,i)=>s+i.totalQty,0);
  const totalAvail=inv.reduce((s,i)=>s+calcAvail(i.id,inv,entries),0);
  const totalOut=totalStock-totalAvail;
  const pendingQty=entries.reduce((s,e)=>s+e.items.filter(r=>r.returnStatus!=='returned').reduce((ss,r)=>ss+(r.qtyGiven-r.qtyReturned),0),0);
  const damagedQty=entries.reduce((s,e)=>s+e.items.filter(r=>r.returnCond==='Damaged').reduce((ss,r)=>ss+r.qtyGiven,0),0);

  const cats=['All',...CATEGORIES];
  const filteredInv=catF==='All'?inv:inv.filter(i=>i.category===catF);

  return (
    <ScrollView contentContainerStyle={{paddingHorizontal:14,paddingBottom:100,paddingTop:10}}>
      {/* Summary */}
      <View style={ss.grid}>
        <SCard title="Total Stock"   value={String(totalStock)}  sub="All items"     color="#6C63FF" icon="🗄"  isDark={isDark}/>
        <SCard title="Available"     value={String(totalAvail)}  sub="Ready to rent" color="#27ae60" icon="✅" isDark={isDark}/>
        <SCard title="Out"           value={String(totalOut)}    sub="Currently out" color="#f39c12" icon="📤" isDark={isDark}/>
        <SCard title="Pending Rtn"   value={String(pendingQty)}  sub="Not returned"  color="#e74c3c" icon="⏳" isDark={isDark}/>
      </View>

      {/* Venue Cards */}
      <Text style={[ss.secTitle,{color:t.text}]}>Venue Stock Overview</Text>
      {VENUES.map(v=>{
        const vItems=inv.filter(i=>i.venue===v);
        const vTotal=vItems.reduce((s,i)=>s+i.totalQty,0);
        const vAvail=vItems.reduce((s,i)=>s+calcAvail(i.id,inv,entries),0);
        const vOut=vTotal-vAvail;
        const low=vItems.filter(i=>calcAvail(i.id,inv,entries)<5).length;
        return (
          <View key={v} style={[ss.venueStockCard,{backgroundColor:t.card,borderColor:t.border}]}>
            <Text style={{color:t.text,fontWeight:'800',fontSize:14,marginBottom:8}}>{v}</Text>
            <View style={{flexDirection:'row',gap:16,marginBottom:8}}>
              <View style={{alignItems:'center'}}>
                <Text style={{color:'#6C63FF',fontSize:18,fontWeight:'800'}}>{vTotal}</Text>
                <Text style={{color:t.sub,fontSize:10}}>Total</Text>
              </View>
              <View style={{alignItems:'center'}}>
                <Text style={{color:'#27ae60',fontSize:18,fontWeight:'800'}}>{vAvail}</Text>
                <Text style={{color:t.sub,fontSize:10}}>Available</Text>
              </View>
              <View style={{alignItems:'center'}}>
                <Text style={{color:'#f39c12',fontSize:18,fontWeight:'800'}}>{vOut}</Text>
                <Text style={{color:t.sub,fontSize:10}}>Out</Text>
              </View>
              <View style={{alignItems:'center'}}>
                <Text style={{color:low>0?'#e74c3c':'#27ae60',fontSize:18,fontWeight:'800'}}>{low}</Text>
                <Text style={{color:t.sub,fontSize:10}}>Low Stock</Text>
              </View>
            </View>
            <View style={{height:6,backgroundColor:t.border,borderRadius:3}}>
              <View style={{height:6,width:`${vTotal>0?(vAvail/vTotal)*100:0}%` as any,backgroundColor:'#27ae60',borderRadius:3}}/>
            </View>
            <Text style={{color:t.sub,fontSize:10,marginTop:3}}>{vTotal>0?Math.round((vAvail/vTotal)*100):0}% available</Text>
          </View>
        );
      })}

      {/* Item-level Stock */}
      <Text style={[ss.secTitle,{color:t.text,marginTop:8}]}>Item Stock Details</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
        {cats.map(c=>(
          <TouchableOpacity key={c} style={[ss.fChip,{backgroundColor:catF===c?'#6C63FF':'transparent',borderColor:catF===c?'#6C63FF':t.border}]} onPress={()=>setCatF(c)}>
            <Text style={{color:catF===c?'#fff':t.sub,fontSize:11,fontWeight:'600'}}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {filteredInv.map(item=>{
        const avail=calcAvail(item.id,inv,entries);
        const out=item.totalQty-avail;
        const isLow=avail<5;
        return (
          <View key={item.id} style={[ss.stockItemRow,{backgroundColor:t.card,borderColor:isLow?'#e74c3c40':t.border}]}>
            <View style={{flex:1}}>
              <View style={{flexDirection:'row',alignItems:'center',marginBottom:3}}>
                <Text style={{color:t.text,fontWeight:'700',fontSize:13,flex:1}}>{item.name}</Text>
                {isLow&&<Text style={{color:'#e74c3c',fontSize:10,fontWeight:'700'}}>⚠ LOW</Text>}
              </View>
              <Text style={{color:t.sub,fontSize:11}}>{item.category} · {item.venue}</Text>
            </View>
            <View style={{alignItems:'flex-end',gap:3}}>
              <Text style={{color:'#27ae60',fontSize:13,fontWeight:'700'}}>{avail} avail</Text>
              <Text style={{color:out>0?'#f39c12':t.sub,fontSize:11}}>{out} out</Text>
              <Text style={{color:'#6C63FF',fontSize:11}}>/{item.totalQty} total</Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─── Inventory View ───────────────────────────────────────────────────────────
function InventoryView({inv,setInv,entries,isDark}:{inv:InvItem[];setInv:React.Dispatch<React.SetStateAction<InvItem[]>>;entries:RentalEntry[];isDark:boolean}) {
  const t=isDark?DK:LT;
  const [catF,setCatF]=useState('All');
  const [search,setSearch]=useState('');
  const [showForm,setShowForm]=useState(false);
  const [editItem,setEditItem]=useState<InvItem|null>(null);
  const [form,setForm]=useState<InvForm>(emptyIF());
  const [isEdit,setIsEdit]=useState(false);

  const filtered=useMemo(()=>{
    let arr=[...inv];
    if(catF!=='All') arr=arr.filter(i=>i.category===catF);
    if(search) arr=arr.filter(i=>i.name.toLowerCase().includes(search.toLowerCase()));
    return arr.sort((a,b)=>a.name.localeCompare(b.name));
  },[inv,catF,search]);

  function openAdd(){setForm(emptyIF());setIsEdit(false);setEditItem(null);setShowForm(true);}
  function openEdit(item:InvItem){setForm({...item,totalQty:String(item.totalQty),rentalPrice:String(item.rentalPrice),purchasePrice:String(item.purchasePrice)});setIsEdit(true);setEditItem(item);setShowForm(true);}

  async function handleSave(){
    if(!form.name){Platform.OS==='web'?window.alert('Enter item name.'):Alert.alert('Required','Enter item name.');return;}
    const payload={...form,totalQty:parseInt(form.totalQty)||0,rentalPrice:parseFloat(form.rentalPrice)||0,purchasePrice:parseFloat(form.purchasePrice)||0};
    try{
      if(isEdit&&editItem){
        const updated=await inventoryApi.update(editItem.id,payload);
        setInv(prev=>prev.map(i=>i.id===editItem.id?{...updated,id:updated._id}:i));
      } else {
        const created=await inventoryApi.create(payload);
        setInv(prev=>[{...created,id:created._id},...prev]);
      }
      setShowForm(false);setEditItem(null);
    }catch(e:any){Alert.alert('Error',e.message);}
  }

  function handleDelete(id:string){
    const del=async()=>{
      try{
        await inventoryApi.remove(id);
        setInv(prev=>prev.filter(i=>i.id!==id));
      }catch(e:any){Alert.alert('Error',e.message);}
    };
    Platform.OS==='web'?window.confirm('Delete this item?')&&del():Alert.alert('Delete','Delete this item?',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:del}]);
  }

  const cats=['All',...CATEGORIES];
  const totalValue=inv.reduce((s,i)=>s+i.totalQty*i.purchasePrice,0);
  const totalRentalVal=inv.reduce((s,i)=>s+i.totalQty*i.rentalPrice,0);

  return (
    <View style={{flex:1}}>
      <View style={{paddingHorizontal:14,paddingTop:10,paddingBottom:6}}>
        <View style={{flexDirection:'row',gap:8,marginBottom:8}}>
          <TextInput style={[ss.searchBox,{backgroundColor:t.card,borderColor:t.border,color:t.text,flex:1}]}
            value={search} onChangeText={setSearch} placeholder="Search items..." placeholderTextColor={t.sub}/>
          <TouchableOpacity style={[ss.sortBtn,{backgroundColor:'#6C63FF',borderColor:'#6C63FF'}]} onPress={openAdd}>
            <Text style={{color:'#fff',fontWeight:'800',fontSize:14}}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={{flexDirection:'row',gap:10,marginBottom:10}}>
          <View style={[ss.invStat,{backgroundColor:'#6C63FF15',borderColor:'#6C63FF30'}]}>
            <Text style={{color:'#6C63FF',fontSize:11}}>Purchase Value</Text>
            <Text style={{color:'#6C63FF',fontWeight:'800',fontSize:13}}>{fmt(totalValue)}</Text>
          </View>
          <View style={[ss.invStat,{backgroundColor:'#27ae6015',borderColor:'#27ae6030'}]}>
            <Text style={{color:'#27ae60',fontSize:11}}>Rental Value</Text>
            <Text style={{color:'#27ae60',fontWeight:'800',fontSize:13}}>{fmt(totalRentalVal)}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {cats.map(c=>(
            <TouchableOpacity key={c} style={[ss.fChip,{backgroundColor:catF===c?'#6C63FF':'transparent',borderColor:catF===c?'#6C63FF':t.border}]} onPress={()=>setCatF(c)}>
              <Text style={{color:catF===c?'#fff':t.sub,fontSize:11,fontWeight:'600'}}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{paddingHorizontal:14,paddingBottom:100}}>
        {filtered.map(item=>{
          const avail=calcAvail(item.id,inv,entries);
          const out=item.totalQty-avail;
          return (
            <View key={item.id} style={[ss.invCard,{backgroundColor:t.card,borderColor:t.border}]}>
              <View style={{flexDirection:'row',alignItems:'flex-start',marginBottom:6}}>
                <View style={{flex:1}}>
                  <Text style={{color:t.text,fontWeight:'800',fontSize:14}}>{item.name}</Text>
                  <Text style={{color:t.sub,fontSize:11}}>{item.category} · {item.venue}</Text>
                </View>
                <View style={{alignItems:'flex-end'}}>
                  <Text style={{color:'#6C63FF',fontSize:13,fontWeight:'700'}}>{fmt(item.rentalPrice)}<Text style={{color:t.sub,fontSize:10}}>/unit</Text></Text>
                </View>
              </View>
              <View style={{flexDirection:'row',gap:16,marginBottom:8}}>
                <View style={{alignItems:'center'}}>
                  <Text style={{color:'#6C63FF',fontSize:16,fontWeight:'800'}}>{item.totalQty}</Text>
                  <Text style={{color:t.sub,fontSize:10}}>Total</Text>
                </View>
                <View style={{alignItems:'center'}}>
                  <Text style={{color:'#27ae60',fontSize:16,fontWeight:'800'}}>{avail}</Text>
                  <Text style={{color:t.sub,fontSize:10}}>Available</Text>
                </View>
                <View style={{alignItems:'center'}}>
                  <Text style={{color:out>0?'#f39c12':t.sub,fontSize:16,fontWeight:'800'}}>{out}</Text>
                  <Text style={{color:t.sub,fontSize:10}}>Out</Text>
                </View>
                <View style={{flex:1}}>
                  <View style={{height:5,backgroundColor:t.border,borderRadius:3,marginTop:8}}>
                    <View style={{height:5,width:`${item.totalQty>0?(avail/item.totalQty)*100:0}%` as any,backgroundColor:avail<5?'#e74c3c':'#27ae60',borderRadius:3}}/>
                  </View>
                  {avail<5&&<Text style={{color:'#e74c3c',fontSize:9,marginTop:2}}>⚠ Low stock</Text>}
                </View>
              </View>
              {!!item.notes&&<Text style={{color:t.sub,fontSize:11,marginBottom:6}}>{item.notes}</Text>}
              <View style={{flexDirection:'row',gap:8}}>
                <TouchableOpacity style={[ss.rowBtn,{borderColor:'#f39c1240',flex:1,justifyContent:'center'}]} onPress={()=>openEdit(item)}>
                  <Text style={{color:'#f39c12',fontSize:12,fontWeight:'600'}}>✏️ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[ss.rowBtn,{borderColor:'#e74c3c40',flex:1,justifyContent:'center'}]} onPress={()=>handleDelete(item.id)}>
                  <Text style={{color:'#e74c3c',fontSize:12,fontWeight:'600'}}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <InvModal visible={showForm} form={form} setForm={setForm} onSave={handleSave}
        onClose={()=>{setShowForm(false);setEditItem(null);}} isDark={isDark} isEdit={isEdit}/>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RentalScreen() {
  const scheme=useColorScheme();
  const [isDark,setIsDark]=useState(scheme==='dark');
  const t=isDark?DK:LT;
  const [view,setView]=useState<AppView>('dashboard');
  const [inv,setInv]=useState<InvItem[]>([]);
  const [entries,setEntries]=useState<RentalEntry[]>([]);
  const [loading,setLoading]=useState(true);
  const [showNewRental,setShowNewRental]=useState(false);
  const [newRentalForm,setNewRentalForm]=useState<RentalForm>(emptyRF());

  function normalizeRental(e:any):RentalEntry{
    return {
      ...e,
      id: e._id,
      items: (e.items??[]).map((r:any)=>({
        ...r,
        // itemId may be a populated object {_id,name} — always extract as string
        itemId: r.itemId && typeof r.itemId==='object' ? String(r.itemId._id) : String(r.itemId??''),
      })),
    };
  }

  const loadData=useCallback(async()=>{
    try{
      const [invData,rentalData]=await Promise.all([
        inventoryApi.getAll(),
        rentalsApi.getAll(),
      ]);
      setInv(invData.map(i=>({...i,id:i._id})));
      setEntries(rentalData.map(normalizeRental));
    }catch(e:any){
      Alert.alert('Error','Could not load data: '+e.message);
    }finally{setLoading(false);}
  },[]);

  useEffect(()=>{loadData();},[loadData]);

  const tabs:[AppView,string,string][]=[
    ['dashboard','🏠','Dashboard'],['rentals','📋','Rentals'],['stock','📦','Stock'],['inventory','🗂','Inventory'],
  ];

  async function resolveItemId(r:RIForm):Promise<string>{
    if(r.itemId) return r.itemId;
    const existing=inv.find(i=>i.name===r.itemName);
    if(existing) return existing.id;
    const preset=INV_PRESETS.find(p=>p.name===r.itemName);
    const created=await inventoryApi.create({
      name:r.itemName, category:preset?.category??'Others', venue:r.venue||VENUES[0],
      totalQty:parseInt(r.qtyGiven)||1,
      rentalPrice:parseFloat(r.pricePerItem)||parseFloat(preset?.rentalPrice??'0'),
      purchasePrice:0, notes:'',
    });
    setInv(prev=>[...prev,{...created,id:created._id}]);
    return created._id;
  }

  async function handleNewRentalSave(){
    if(!newRentalForm.customerName||!newRentalForm.eventName) return;
    try{
      const items:RentalItem[]=await Promise.all(newRentalForm.items.filter(r=>r.itemName).map(async r=>({
        itemId:await resolveItemId(r),itemName:r.itemName,venue:r.venue,
        qtyGiven:parseInt(r.qtyGiven)||0,pricePerItem:parseFloat(r.pricePerItem)||0,
        returnStatus:'pending' as ReturnSt,qtyReturned:0,
        returnCond:'Good' as ItemCond,damageNotes:'',penalty:0,returnDate:'',
      })));
      const payload = {...newRentalForm, items} as any;
      const created = await rentalsApi.create(payload);
      setEntries(prev=>[normalizeRental(created),...prev]);
      setShowNewRental(false);
      setNewRentalForm(emptyRF());
      setView('rentals');
    }catch(e:any){Alert.alert('Error',e.message);}
  }

  if(loading) return (
    <SafeAreaView style={[ss.safe,{backgroundColor:t.bg,alignItems:'center',justifyContent:'center'}]}>
      <Text style={{color:t.sub,fontSize:15}}>Loading data...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[ss.safe,{backgroundColor:t.bg}]}>
      <StatusBar barStyle={isDark?'light-content':'dark-content'}/>
      {/* Header */}
      <View style={[ss.header,{backgroundColor:t.card,borderBottomColor:t.border}]}>
        <View>
          <Text style={[ss.headerTitle,{color:t.text}]}>Rental Inventory</Text>
          <Text style={{color:t.sub,fontSize:11}}>A1 Groups Event Management</Text>
        </View>
        <TouchableOpacity style={[ss.darkBtn,{backgroundColor:isDark?'#ffffff15':'#6C63FF15'}]} onPress={()=>setIsDark(!isDark)}>
          <Text>{isDark?'☀️':'🌙'}</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={{flex:1}}>
        {view==='dashboard'&&<DashboardView entries={entries} inv={inv} isDark={isDark} onNewRental={()=>{setNewRentalForm(emptyRF());setShowNewRental(true);}}/>}
        {view==='rentals'&&<RentalsView entries={entries} setEntries={setEntries} inv={inv} setInv={setInv} isDark={isDark}/>}
        {view==='stock'&&<StockView entries={entries} inv={inv} isDark={isDark}/>}
        {view==='inventory'&&<InventoryView inv={inv} setInv={setInv} entries={entries} isDark={isDark}/>}
      </View>

      {/* Bottom Nav */}
      <View style={[ss.nav,{backgroundColor:t.nav,borderTopColor:t.border}]}>
        {tabs.map(([v,icon,label])=>(
          <TouchableOpacity key={v} style={ss.navItem} onPress={()=>setView(v)}>
            <Text style={{fontSize:20}}>{icon}</Text>
            <Text style={{color:view===v?'#6C63FF':t.sub,fontSize:10,fontWeight:view===v?'700':'400',marginTop:2}}>{label}</Text>
            {view===v&&<View style={{position:'absolute',bottom:-1,width:24,height:3,backgroundColor:'#6C63FF',borderRadius:2}}/>}
          </TouchableOpacity>
        ))}
      </View>

      {/* Dashboard quick-add rental modal */}
      <RentalModal visible={showNewRental} form={newRentalForm} setForm={setNewRentalForm}
        onSave={handleNewRentalSave} onClose={()=>setShowNewRental(false)}
        isDark={isDark} isEdit={false} inv={inv} entries={entries}/>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ss=StyleSheet.create({
  safe:         {flex:1},
  header:       {flexDirection:'row',alignItems:'center',padding:14,borderBottomWidth:1},
  headerTitle:  {fontSize:20,fontWeight:'800'},
  darkBtn:      {padding:8,borderRadius:8},
  nav:          {flexDirection:'row',borderTopWidth:1,paddingBottom:Platform.OS==='ios'?16:4,paddingTop:6},
  navItem:      {flex:1,alignItems:'center',paddingVertical:4,position:'relative'},
  grid:         {flexDirection:'row',flexWrap:'wrap',padding:12,gap:8},
  sCard:        {width:(W-48)/2,padding:12,borderRadius:12,borderWidth:1},
  sIcon:        {width:34,height:34,borderRadius:10,alignItems:'center',justifyContent:'center',marginBottom:6},
  sTitle:       {fontSize:11,marginBottom:2},
  sVal:         {fontSize:16,fontWeight:'800'},
  quickAdd:     {marginHorizontal:14,marginBottom:14,padding:14,borderRadius:12,alignItems:'center'},
  chartCard:    {marginHorizontal:14,marginBottom:12,padding:14,borderRadius:12,borderWidth:1},
  chartTitle:   {fontSize:14,fontWeight:'700',marginBottom:12},
  miniCard:     {padding:10,borderRadius:9,borderWidth:1,marginBottom:8},
  secTitle:     {fontSize:15,fontWeight:'700',marginBottom:10,paddingHorizontal:0},
  venueStockCard:{padding:14,borderRadius:12,borderWidth:1,marginBottom:10},
  stockItemRow: {flexDirection:'row',alignItems:'center',padding:12,borderRadius:10,borderWidth:1,marginBottom:8},
  invCard:      {padding:14,borderRadius:12,borderWidth:1,marginBottom:10},
  invStat:      {flex:1,padding:10,borderRadius:9,borderWidth:1},
  rentalCard:   {padding:13,borderRadius:12,borderWidth:1,marginBottom:10},
  fChip:        {paddingHorizontal:12,paddingVertical:5,borderRadius:16,borderWidth:1,marginRight:7},
  searchBox:    {padding:10,borderRadius:9,borderWidth:1,fontSize:14},
  sortBtn:      {paddingHorizontal:12,paddingVertical:10,borderRadius:9,borderWidth:1,alignItems:'center',justifyContent:'center'},
  rowBtn:       {paddingHorizontal:10,paddingVertical:6,borderRadius:7,borderWidth:1,alignItems:'center'},
  overlay:      {flex:1,backgroundColor:'#00000080',justifyContent:'flex-end'},
  sheet:        {maxHeight:'92%',borderTopLeftRadius:20,borderTopRightRadius:20,padding:18},
  sheetTitle:   {fontSize:18,fontWeight:'700'},
  secHead:      {fontSize:13,fontWeight:'700',paddingBottom:10,borderBottomWidth:1,marginBottom:12},
  label:        {fontSize:12,fontWeight:'600',marginBottom:5},
  trigger:      {flexDirection:'row',alignItems:'center',padding:11,borderRadius:8,borderWidth:1,marginBottom:0},
  selPanel:     {margin:20,borderRadius:12,borderWidth:1,padding:12},
  selSearch:    {padding:9,borderRadius:8,borderWidth:1,marginBottom:8},
  selOpt:       {padding:12,borderRadius:6},
  inp:          {padding:11,borderRadius:8,borderWidth:1,marginBottom:10,fontSize:14},
  itemRow:      {padding:12,borderRadius:10,borderWidth:1,marginBottom:10},
  addItemBtn:   {padding:12,borderRadius:9,borderWidth:1.5,alignItems:'center',marginBottom:12},
  totalBox:     {padding:14,borderRadius:10,borderWidth:1,alignItems:'center',marginBottom:12},
  saveBtn:      {padding:14,borderRadius:10,alignItems:'center'},
  saveTxt:      {color:'#fff',fontWeight:'700',fontSize:15},
  detailBlock:  {padding:16,borderRadius:12,borderWidth:1,alignItems:'center',marginBottom:12},
  detRow:       {flexDirection:'row',paddingVertical:10,borderBottomWidth:1},
  viewItemRow:  {padding:12,borderRadius:9,borderWidth:1,marginBottom:8},
  actBtn:       {flex:1,padding:11,borderRadius:8,alignItems:'center'},
  actTxt:       {color:'#fff',fontWeight:'600',fontSize:13},
});
