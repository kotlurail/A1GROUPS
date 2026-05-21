import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  StyleSheet, Platform, Alert, SafeAreaView,
  StatusBar, Image,
} from 'react-native';
import { useColorScheme } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { eventsApi, uploadApi } from '../../lib/api';
import ImageViewer from '../../lib/ImageViewer';

let ImagePicker: any = null;
try { ImagePicker = require('expo-image-picker'); } catch {}


const TODAY = '2026-05-15';

// ─── Types ────────────────────────────────────────────────────────────────────
type AppView = 'dashboard' | 'detail';
type SortKey = 'newest' | 'oldest' | 'amount-desc' | 'amount-asc' | 'name-az';

interface DecorItem { id: string; name: string; qty: string; unitCost: string; }
interface DecorSection {
  id: string; heading: string; images: string[];
  items: DecorItem[]; taxPct: string; discount: string;
}
interface EventEntry {
  id: string; eventName: string; customerName: string; mobile: string;
  eventDate: string; location: string; eventType: string;
  decors: DecorSection[]; advance: string; createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EVENT_TYPES = [
  'Wedding','Reception','Engagement','Birthday','Half Saree',
  'Dhoti Ceremony','Haldi','Sangeeth','Baby Shower','Corporate Event','Others',
];
const DECOR_ITEMS = [
  'Stage Backdrop','Floral Stage Setup','Stage Carpet','Stage Pillars',
  'Sofa / Throne Setup','Mandap Decoration','Bridal Entry Arch',
  'Welcome Arch','Entrance Pillars','Entry Gate Decoration',
  'Name Board','Neon Sign','Neon Light Border',
  'Fresh Flower Arch','Flower Wall Panel','Artificial Flower Setup',
  'Balloon Decoration','Balloon Arch','Balloon Bouquets','Paper Flower Backdrop',
  'LED Light Curtain','Fairy Lights','Chandelier','Ceiling Draping',
  'LED Spotlight Setup',
  'Table Centerpiece','Chair Decoration','Table Runner',
  'Dining Table Setup','Cake Table Setup',
  'Aisle Decoration','Floral Garland','Rangoli Design',
  'Diyas / Candles Setup','Photo Booth Setup',
  'Haldi Decoration','Mehndi Decoration','Baby Shower Setup',
  'Car Decoration','Photo Frame Wall',
  'Floral Swing','Photo Ladder','Mirror Board','Acrylic Name Board',
  'Hanging Decoration','Confetti Setup','Smoke Machine',
  'Green Wall','Grass Carpet','Petal Shower Setup',
];
const SORT_OPTS: {key:SortKey;label:string;icon:string}[] = [
  {key:'newest',      label:'Newest First',   icon:'🕐'},
  {key:'oldest',      label:'Oldest First',   icon:'🕰'},
  {key:'amount-desc', label:'Highest Amount', icon:'💰'},
  {key:'amount-asc',  label:'Lowest Amount',  icon:'💸'},
  {key:'name-az',     label:'Name A–Z',       icon:'🔤'},
];

// ─── API ↔ Frontend converters ────────────────────────────────────────────────
function fromApi(data: any): EventEntry {
  return {
    id:           data._id,
    eventName:    data.eventName,
    customerName: data.customerName,
    mobile:       data.mobile,
    eventDate:    data.eventDate,
    location:     data.location,
    eventType:    data.eventType,
    advance:      String(data.advance ?? ''),
    createdAt:    (data.createdAt ?? TODAY).slice(0, 10),
    decors: (data.decors ?? []).map((d: any) => ({
      id:       d._id,
      heading:  d.heading,
      images:   d.images ?? [],
      taxPct:   String(d.taxPct  || ''),
      discount: String(d.discount || ''),
      items: (d.items ?? []).map((i: any) => ({
        id:       i._id,
        name:     i.name,
        qty:      String(i.qty      ?? '1'),
        unitCost: String(i.unitCost ?? ''),
      })),
    })),
  };
}

function toPayload(ev: EventEntry) {
  return {
    eventName: ev.eventName, customerName: ev.customerName,
    mobile: ev.mobile, eventDate: ev.eventDate,
    location: ev.location, eventType: ev.eventType,
    advance: pf(ev.advance),
    decors: ev.decors.map(d => ({
      heading: d.heading, images: d.images,
      taxPct: pf(d.taxPct), discount: pf(d.discount),
      items: d.items.filter(i => i.name).map(i => ({
        name: i.name, qty: pi(i.qty), unitCost: pf(i.unitCost),
      })),
    })),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n:number)=>'₹'+n.toLocaleString('en-IN');
const uid   = ()=>Math.random().toString(36).slice(2);
const pf    = (s:string)=>parseFloat(s)||0;
const pi    = (s:string)=>parseInt(s)||0;

function secSubtotal(d:DecorSection):number {
  return d.items.reduce((s,i)=>s+pi(i.qty)*pf(i.unitCost),0);
}
function secTax(d:DecorSection):number {
  return Math.round(secSubtotal(d)*pf(d.taxPct)/100);
}
function secTotal(d:DecorSection):number {
  return secSubtotal(d)+secTax(d)-pf(d.discount);
}
function eventGrandTotal(e:EventEntry):number {
  return e.decors.reduce((s,d)=>s+secTotal(d),0);
}
function eventBalance(e:EventEntry):number {
  return eventGrandTotal(e)-pf(e.advance);
}

const emptyDecorItem = ():DecorItem=>({id:uid(),name:'',qty:'1',unitCost:''});
const emptySection   = ():DecorSection=>({id:uid(),heading:'',images:[],items:[emptyDecorItem()],taxPct:'',discount:''});
const emptyEvent     = ():EventEntry=>({
  id:uid(),eventName:'',customerName:'',mobile:'',eventDate:TODAY,
  location:'',eventType:EVENT_TYPES[0],decors:[emptySection()],advance:'',createdAt:TODAY,
});

// ─── Theme ────────────────────────────────────────────────────────────────────
const LT={bg:'#faf8ff',card:'#ffffff',text:'#1a1030',sub:'#6b7280',border:'#e8e0f8',accent:'#7C3AED'};
const DK={bg:'#0d0b14',card:'#1a1630',text:'#f0eaff',sub:'#8b889e',border:'#2e2a45',accent:'#9f7aea'};

// ─── SelectField ──────────────────────────────────────────────────────────────
function Sel({label,value,options,onChange,isDark,ph}:{label?:string;value:string;options:string[];onChange(v:string):void;isDark:boolean;ph?:string}) {
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState('');
  const t=isDark?DK:LT;
  const fil=options.filter(o=>o.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      {label&&<Text style={[s.label,{color:t.sub}]}>{label}</Text>}
      <TouchableOpacity style={[s.trigger,{backgroundColor:t.card,borderColor:t.border}]} onPress={()=>{setQ('');setOpen(true);}}>
        <Text style={{color:value?t.text:t.sub,flex:1,fontSize:14}}>{value||ph||'Select...'}</Text>
        <Text style={{color:t.sub}}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={()=>setOpen(false)}>
          <View style={[s.selPanel,{backgroundColor:t.card,borderColor:t.border}]} onStartShouldSetResponder={()=>true}>
            <TextInput style={[s.selSearch,{backgroundColor:t.bg,color:t.text,borderColor:t.border}]}
              placeholder="Search..." placeholderTextColor={t.sub} value={q} onChangeText={setQ} autoFocus/>
            <ScrollView style={{maxHeight:240}}>
              {fil.map(o=>(
                <TouchableOpacity key={o} style={s.selOpt} onPress={()=>{onChange(o);setOpen(false);}}>
                  <Text style={{color:value===o?t.accent:t.text,fontWeight:value===o?'700':'400',fontSize:14}}>{o}</Text>
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
  if(Platform.OS==='web') return (
    <View style={{marginBottom:10}}>
      {!!label&&<Text style={[s.label,{color:t.sub}]}>{label}</Text>}
      <input type="date" value={value} onChange={e=>onChange((e.target as HTMLInputElement).value)}
        style={{padding:10,borderRadius:8,border:`1px solid ${t.border}`,backgroundColor:t.card,color:t.text,width:'100%',fontSize:14,boxSizing:'border-box'}}/>
    </View>
  );
  return (
    <View style={{marginBottom:10}}>
      {!!label&&<Text style={[s.label,{color:t.sub}]}>{label}</Text>}
      <TextInput style={[s.trigger,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
        value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={t.sub}/>
    </View>
  );
}

// ─── Image Carousel ───────────────────────────────────────────────────────────
function ImageCarousel({images,onAdd,onRemove,isDark,uploading}:{images:string[];onAdd():void;onRemove(i:number):void;isDark:boolean;uploading?:boolean}) {
  const [idx,setIdx]=useState(0);
  const [fullImgIdx,setFullImgIdx]=useState<number|null>(null);
  const t=isDark?DK:LT;
  const cur=Math.min(idx,Math.max(0,images.length-1));

  function handleRemove(i:number){
    onRemove(i);
    if(i<=cur&&cur>0) setIdx(cur-1);
  }

  if(uploading) return (
    <View style={[s.carEmpty,{borderColor:t.border,backgroundColor:t.bg}]}>
      <Text style={{fontSize:24}}>⏳</Text>
      <Text style={{color:t.accent,fontSize:12,marginTop:4,fontWeight:'700'}}>Uploading photos…</Text>
    </View>
  );

  if(images.length===0) return (
    <TouchableOpacity style={[s.carEmpty,{borderColor:t.border,backgroundColor:t.bg}]} onPress={onAdd}>
      <Text style={{fontSize:28}}>📷</Text>
      <Text style={{color:t.sub,fontSize:12,marginTop:4}}>Add Photos</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <View style={[s.carWrap,{borderColor:t.border}]}>
        <TouchableOpacity activeOpacity={0.9} onPress={()=>setFullImgIdx(cur)}>
          <Image source={{uri:images[cur]}} style={s.carMain} resizeMode="contain"/>
        </TouchableOpacity>
        {/* Delete current */}
        <TouchableOpacity style={s.carDel} onPress={()=>handleRemove(cur)}>
          <Text style={{color:'#fff',fontSize:13}}>🗑</Text>
        </TouchableOpacity>
        {/* Counter */}
        <View style={s.carCounter}>
          <Text style={{color:'#fff',fontSize:11,fontWeight:'600'}}>{cur+1}/{images.length}</Text>
        </View>
        {/* Add more */}
        <TouchableOpacity style={s.carAddMore} onPress={onAdd}>
          <Text style={{color:'#fff',fontSize:11,fontWeight:'600'}}>+ Add</Text>
        </TouchableOpacity>
        {/* Prev / Next arrows */}
        {images.length>1&&(
          <>
            <TouchableOpacity style={[s.carArrow,{left:0}]} onPress={()=>setIdx(Math.max(0,cur-1))} disabled={cur===0}>
              <Text style={{color:'#fff',fontSize:22,fontWeight:'700',opacity:cur===0?0.3:1}}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.carArrow,{right:0}]} onPress={()=>setIdx(Math.min(images.length-1,cur+1))} disabled={cur===images.length-1}>
              <Text style={{color:'#fff',fontSize:22,fontWeight:'700',opacity:cur===images.length-1?0.3:1}}>›</Text>
            </TouchableOpacity>
          </>
        )}
        {/* Dot indicators */}
        {images.length>1&&(
          <View style={s.carDots}>
            {images.map((_,i)=>(
              <TouchableOpacity key={i} onPress={()=>setIdx(i)}>
                <View style={[s.carDot,{width:i===cur?16:6,opacity:i===cur?1:0.45}]}/>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      {/* Thumbnail strip */}
      {images.length>1&&(
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginTop:7,marginBottom:10}}>
          {images.map((uri,i)=>(
            <TouchableOpacity key={i} onPress={()=>setIdx(i)} style={{marginRight:6}}>
              <Image source={{uri}} style={[s.carThumb,{borderWidth:i===cur?2:0,borderColor:t.accent,opacity:i===cur?1:0.55}]} resizeMode="contain"/>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {/* Full-screen viewer */}
      {fullImgIdx !== null && (
        <ImageViewer
          images={images}
          initialIndex={fullImgIdx}
          onClose={() => setFullImgIdx(null)}
        />
      )}
    </>
  );
}

// ─── Decor Item Row ───────────────────────────────────────────────────────────
function DecorItemRow({item,onChange,onDelete,isDark,idx}:{item:DecorItem;onChange(p:Partial<DecorItem>):void;onDelete():void;isDark:boolean;idx:number}) {
  const t=isDark?DK:LT;
  const total=pi(item.qty)*pf(item.unitCost);
  return (
    <View style={[s.itemRow,{backgroundColor:t.bg,borderColor:t.border}]}>
      <View style={{flexDirection:'row',alignItems:'center',marginBottom:6}}>
        <Text style={{color:t.sub,fontSize:11,fontWeight:'700',marginRight:6}}>#{idx+1}</Text>
        <View style={{flex:1}}>
          <Sel value={item.name} options={DECOR_ITEMS} onChange={v=>onChange({name:v})} isDark={isDark} ph="Select decor item..."/>
        </View>
        <TouchableOpacity onPress={onDelete} style={{marginLeft:8,padding:4}}>
          <Text style={{color:'#e74c3c',fontSize:16}}>🗑</Text>
        </TouchableOpacity>
      </View>
      <View style={{flexDirection:'row',gap:8,alignItems:'flex-end'}}>
        <View style={{flex:1}}>
          <Text style={[s.label,{color:t.sub}]}>Qty</Text>
          <TextInput style={[s.miniInp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
            value={item.qty} onChangeText={v=>onChange({qty:v})} keyboardType="numeric" placeholder="1" placeholderTextColor={t.sub}/>
        </View>
        <View style={{flex:1.5}}>
          <Text style={[s.label,{color:t.sub}]}>Unit Cost (₹)</Text>
          <TextInput style={[s.miniInp,{backgroundColor:t.card,borderColor:t.border,color:t.text}]}
            value={item.unitCost} onChangeText={v=>onChange({unitCost:v})} keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}/>
        </View>
        <View style={{flex:1.5,alignItems:'flex-end'}}>
          <Text style={[s.label,{color:t.sub}]}>Total</Text>
          <View style={[s.miniInp,{backgroundColor:t.accent+'15',borderColor:t.accent+'30',justifyContent:'center'}]}>
            <Text style={{color:t.accent,fontWeight:'700',fontSize:13}}>{total>0?fmt(total):'—'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Decor Section ────────────────────────────────────────────────────────────
function DecorSectionBlock({section,onChange,onDelete,isDark,idx}:{
  section:DecorSection;onChange(p:Partial<DecorSection>):void;onDelete():void;isDark:boolean;idx:number;
}) {
  const [expanded,setExpanded]=useState(true);
  const [uploading,setUploading]=useState(false);
  const t=isDark?DK:LT;
  const sub=secSubtotal(section);
  const tax=secTax(section);
  const disc=pf(section.discount);
  const total=secTotal(section);

  function updateItem(itemId:string,patch:Partial<DecorItem>) {
    onChange({items:section.items.map(i=>i.id===itemId?{...i,...patch}:i)});
  }
  function deleteItem(itemId:string) {
    onChange({items:section.items.filter(i=>i.id!==itemId)});
  }
  function addItem() {
    onChange({items:[...section.items,emptyDecorItem()]});
  }

  async function pickImage() {
    if(!ImagePicker){Alert.alert('Image picker not available');return;}
    try {
      const perm=await ImagePicker.requestMediaLibraryPermissionsAsync();
      if(!perm.granted){Alert.alert('Permission required','Allow access to photos to upload images.');return;}
      const res=await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection:true,quality:0.7,
      });
      if(res.canceled||!res.assets?.length) return;
      setUploading(true);
      try {
        const urls=await Promise.all(res.assets.map((a:any)=>uploadApi.uploadImage(a.uri)));
        onChange({images:[...section.images,...urls]});
      } catch(e:any){Alert.alert('Upload failed',e.message);}
      finally{setUploading(false);}
    } catch {}
  }

  return (
    <View style={[s.secBlock,{backgroundColor:t.card,borderColor:t.border}]}>
      {/* Section Header */}
      <TouchableOpacity style={[s.secHeader,{borderBottomColor:expanded?t.border:'transparent'}]} onPress={()=>setExpanded(!expanded)}>
        <View style={[s.secNum,{backgroundColor:t.accent+'20'}]}>
          <Text style={{color:t.accent,fontWeight:'800',fontSize:12}}>{idx+1}</Text>
        </View>
        <TextInput
          style={[s.secHeadInput,{color:t.text}]}
          value={section.heading}
          onChangeText={v=>onChange({heading:v})}
          placeholder={`Decor Section ${idx+1} (e.g. Stage Decoration)`}
          placeholderTextColor={t.sub}
          onPress={e=>e.stopPropagation?.()}
        />
        <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
          {total>0&&<Text style={{color:t.accent,fontSize:12,fontWeight:'700'}}>{fmt(total)}</Text>}
          <Text style={{color:t.sub,fontSize:15}}>{expanded?'▲':'▼'}</Text>
          <TouchableOpacity onPress={onDelete} style={{padding:4}}>
            <Text style={{color:'#e74c3c',fontSize:15}}>🗑</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {expanded&&(
        <View style={{padding:12}}>
          {/* Image Carousel */}
          <Text style={[s.label,{color:t.sub,marginBottom:6}]}>📸 Images</Text>
          <ImageCarousel
            images={section.images}
            onAdd={pickImage}
            onRemove={i=>onChange({images:section.images.filter((_,idx2)=>idx2!==i)})}
            isDark={isDark}
            uploading={uploading}
          />

          {/* Item Rows */}
          <Text style={[s.label,{color:t.sub,marginTop:4,marginBottom:8}]}>📦 Decor Items</Text>
          {section.items.map((item,i)=>(
            <DecorItemRow key={item.id} item={item} idx={i}
              onChange={p=>updateItem(item.id,p)}
              onDelete={()=>deleteItem(item.id)}
              isDark={isDark}/>
          ))}
          <TouchableOpacity style={[s.addItemBtn,{borderColor:t.accent}]} onPress={addItem}>
            <Text style={{color:t.accent,fontWeight:'700',fontSize:13}}>+ Add Item</Text>
          </TouchableOpacity>

          {/* Totals */}
          <View style={[s.secTotals,{backgroundColor:t.accent+'08',borderColor:t.accent+'20'}]}>
            <View style={s.totRow}>
              <Text style={{color:t.sub,fontSize:13}}>Subtotal</Text>
              <Text style={{color:t.text,fontSize:13,fontWeight:'600'}}>{fmt(sub)}</Text>
            </View>
            <View style={[s.totRow,{alignItems:'center'}]}>
              <Text style={{color:t.sub,fontSize:13}}>Tax (%)</Text>
              <TextInput style={[s.inlineInp,{color:t.text,borderColor:t.border,backgroundColor:t.card}]}
                value={section.taxPct} onChangeText={v=>onChange({taxPct:v})} keyboardType="numeric"
                placeholder="0" placeholderTextColor={t.sub}/>
              <Text style={{color:t.text,fontSize:13,fontWeight:'600',minWidth:60,textAlign:'right'}}>{tax>0?fmt(tax):'—'}</Text>
            </View>
            <View style={[s.totRow,{alignItems:'center'}]}>
              <Text style={{color:t.sub,fontSize:13}}>Discount (₹)</Text>
              <TextInput style={[s.inlineInp,{color:t.text,borderColor:t.border,backgroundColor:t.card}]}
                value={section.discount} onChangeText={v=>onChange({discount:v})} keyboardType="numeric"
                placeholder="0" placeholderTextColor={t.sub}/>
              <Text style={{color:'#27ae60',fontSize:13,fontWeight:'600',minWidth:60,textAlign:'right'}}>{disc>0?'-'+fmt(disc):'—'}</Text>
            </View>
            <View style={[s.totRow,{borderTopWidth:1,borderTopColor:t.accent+'30',paddingTop:8,marginTop:4}]}>
              <Text style={{color:t.accent,fontSize:14,fontWeight:'800'}}>Section Total</Text>
              <Text style={{color:t.accent,fontSize:16,fontWeight:'800'}}>{fmt(total)}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Sort Modal ───────────────────────────────────────────────────────────────
function SortModal({visible,current,onSelect,onClose,isDark}:{visible:boolean;current:SortKey;onSelect(k:SortKey):void;onClose():void;isDark:boolean}) {
  const t=isDark?DK:LT;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[s.sheet,{backgroundColor:t.bg,maxHeight:360}]} onStartShouldSetResponder={()=>true}>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:14}}>
            <Text style={[s.sheetTitle,{color:t.text}]}>Sort Events</Text>
            <View style={{flex:1}}/>
            <TouchableOpacity onPress={onClose}><Text style={{color:t.sub,fontSize:22}}>✕</Text></TouchableOpacity>
          </View>
          {SORT_OPTS.map(opt=>{
            const active=current===opt.key;
            return (
              <TouchableOpacity key={opt.key}
                style={{flexDirection:'row',alignItems:'center',padding:13,borderRadius:10,marginBottom:6,borderWidth:1,
                  borderColor:active?t.accent+'50':t.border,backgroundColor:active?t.accent+'12':'transparent'}}
                onPress={()=>{onSelect(opt.key);onClose();}}>
                <Text style={{fontSize:17,marginRight:12}}>{opt.icon}</Text>
                <Text style={{color:active?t.accent:t.text,fontWeight:active?'700':'400',fontSize:14,flex:1}}>{opt.label}</Text>
                {active&&<Text style={{color:t.accent}}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────
function EventCard({event,onView,onEdit,onDelete,onPrint,isDark}:{
  event:EventEntry;onView():void;onEdit():void;onDelete():void;onPrint():void;isDark:boolean;
}) {
  const t=isDark?DK:LT;
  const grand=eventGrandTotal(event);
  const bal=eventBalance(event);
  const firstImg=event.decors.find(d=>d.images.length>0)?.images[0];
  const typeColor:{[k:string]:string}={
    Wedding:'#e91e63',Reception:'#9c27b0',Engagement:'#673ab7',Birthday:'#ff5722',
    'Half Saree':'#e91e63',Haldi:'#ff9800',Sangeeth:'#2196f3','Baby Shower':'#00bcd4',
    'Corporate Event':'#607d8b',Others:'#795548',
  };
  const col=typeColor[event.eventType]??t.accent;
  return (
    <View style={[s.eCard,{backgroundColor:t.card,borderColor:t.border}]}>
      {firstImg&&<Image source={{uri:firstImg}} style={s.eCardThumb} resizeMode="contain"/>}
      <View style={[s.eCardBadge,{backgroundColor:col+'20',borderColor:col+'40'}]}>
        <Text style={{color:col,fontSize:10,fontWeight:'700'}}>{event.eventType}</Text>
      </View>
      <View style={{padding:12}}>
        <View style={{flexDirection:'row',alignItems:'flex-start',marginBottom:4}}>
          <View style={{flex:1}}>
            <Text style={{color:t.text,fontSize:15,fontWeight:'800'}}>{event.eventName||'Unnamed Event'}</Text>
            <Text style={{color:t.sub,fontSize:12}}>{event.customerName} · {event.mobile}</Text>
          </View>
          <View style={{alignItems:'flex-end'}}>
            <Text style={{color:t.accent,fontSize:16,fontWeight:'800'}}>{fmt(grand)}</Text>
            <Text style={{color:bal>0?'#e74c3c':'#27ae60',fontSize:11}}>Bal: {fmt(Math.abs(bal))}</Text>
          </View>
        </View>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10}}>
          <Text style={{color:t.sub,fontSize:11}}>📅 {event.eventDate}</Text>
          <Text style={{color:t.sub,fontSize:11}}>📍 {event.location||'No location'}</Text>
          <Text style={{color:t.sub,fontSize:11}}>🎨 {event.decors.length} decor section{event.decors.length!==1?'s':''}</Text>
        </View>
        <View style={{flexDirection:'row',gap:7}}>
          {[['👁','#3498db',onView],['✏️','#f39c12',onEdit],['🖨','#8e44ad',onPrint],['🗑','#e74c3c',onDelete]].map(([icon,clr,fn])=>(
            <TouchableOpacity key={String(icon)} style={[s.cardBtn,{borderColor:String(clr)+'40',flex:1}]} onPress={fn as ()=>void}>
              <Text style={{color:String(clr),fontSize:16}}>{String(icon)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Event Detail View ────────────────────────────────────────────────────────
function EventDetailView({initial,onBack,onSave,isDark}:{
  initial:EventEntry;onBack():void;onSave(e:EventEntry):void;isDark:boolean;
}) {
  const [ev,setEv]=useState<EventEntry>({...initial,decors:initial.decors.map(d=>({...d,items:[...d.items]}))});
  const t=isDark?DK:LT;
  const [showInfo,setShowInfo]=useState(true);

  function upEv(p:Partial<EventEntry>){setEv(prev=>({...prev,...p}));}
  function upDecor(id:string,p:Partial<DecorSection>){
    setEv(prev=>({...prev,decors:prev.decors.map(d=>d.id===id?{...d,...p}:d)}));
  }
  function addDecor(){setEv(prev=>({...prev,decors:[...prev.decors,emptySection()]}));}
  function delDecor(id:string){setEv(prev=>({...prev,decors:prev.decors.filter(d=>d.id!==id)}));}

  const grand=eventGrandTotal(ev);
  const bal=eventBalance(ev);

  async function handlePrint() {
    const secHtml=ev.decors.map(d=>{
      const rows=d.items.filter(i=>i.name).map(i=>`
        <tr><td>${i.name}</td><td align="center">${pi(i.qty)}</td><td align="right">₹${pf(i.unitCost).toLocaleString('en-IN')}</td>
        <td align="right">₹${(pi(i.qty)*pf(i.unitCost)).toLocaleString('en-IN')}</td></tr>`).join('');
      return `<div style="margin-top:16px;border:1px solid #e0d0ff;border-radius:8px;overflow:hidden">
        <div style="background:#7C3AED;color:white;padding:10px 14px;font-weight:700">${d.heading||'Decor Section'}</div>
        <table width="100%" cellpadding="8" style="border-collapse:collapse">
          <tr style="background:#f8f4ff"><th align="left">Item</th><th align="center">Qty</th><th align="right">Unit</th><th align="right">Total</th></tr>
          ${rows}
        </table>
        <div style="padding:10px 14px;background:#faf8ff;text-align:right">
          <span>Subtotal: <b>₹${secSubtotal(d).toLocaleString('en-IN')}</b></span>
          ${pf(d.taxPct)>0?` &nbsp;|&nbsp; Tax(${d.taxPct}%): <b>₹${secTax(d).toLocaleString('en-IN')}</b>`:''}
          ${pf(d.discount)>0?` &nbsp;|&nbsp; Discount: <b style="color:green">-₹${pf(d.discount).toLocaleString('en-IN')}</b>`:''}
          &nbsp;&nbsp; <b style="color:#7C3AED;font-size:15px">Section Total: ₹${secTotal(d).toLocaleString('en-IN')}</b>
        </div>
      </div>`;
    }).join('');
    const html=`<html><body style="font-family:sans-serif;padding:24px;max-width:700px;margin:auto">
      <div style="background:linear-gradient(135deg,#7C3AED,#9f7aea);color:white;padding:20px;border-radius:12px;margin-bottom:16px">
        <h2 style="margin:0 0 6px">${ev.eventName||'Event Estimate'}</h2>
        <p style="margin:2px 0">${ev.customerName} · ${ev.mobile}</p>
        <p style="margin:2px 0">${ev.eventType} · ${ev.eventDate} · ${ev.location}</p>
      </div>
      ${secHtml}
      <div style="margin-top:20px;background:#f8f4ff;border:2px solid #7C3AED;border-radius:12px;padding:16px">
        <h3 style="color:#7C3AED;margin:0 0 12px">Grand Total Summary</h3>
        <table width="100%"><tr><td>Total Decoration Cost</td><td align="right"><b>₹${grand.toLocaleString('en-IN')}</b></td></tr>
        <tr><td>Advance Paid</td><td align="right" style="color:green"><b>₹${pf(ev.advance).toLocaleString('en-IN')}</b></td></tr>
        <tr style="border-top:1px solid #ddd"><td><b style="font-size:16px">Balance Due</b></td>
        <td align="right"><b style="font-size:16px;color:${bal>0?'#e74c3c':'#27ae60'}">₹${Math.abs(bal).toLocaleString('en-IN')}</b></td></tr></table>
      </div>
      <p style="color:#999;font-size:11px;margin-top:16px;text-align:center">Generated by A1 Groups App · ${TODAY}</p>
    </body></html>`;
    try{const{uri}=await Print.printToFileAsync({html});await Sharing.shareAsync(uri);}catch{}
  }

  return (
    <View style={{flex:1}}>
      {/* Top Bar */}
      <View style={[s.detailBar,{backgroundColor:t.card,borderBottomColor:t.border}]}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={{color:t.accent,fontSize:16,fontWeight:'700'}}>← Back</Text>
        </TouchableOpacity>
        <View style={{flex:1,marginHorizontal:10}}>
          <Text style={{color:t.text,fontWeight:'800',fontSize:14}} numberOfLines={1}>{ev.eventName||'New Event'}</Text>
          <Text style={{color:t.sub,fontSize:11}} numberOfLines={1}>{ev.customerName||'Customer'}</Text>
        </View>
        <View style={{flexDirection:'row',gap:8}}>
          <TouchableOpacity style={[s.topBtn,{backgroundColor:'#8e44ad20',borderColor:'#8e44ad40'}]} onPress={handlePrint}>
            <Text style={{color:'#8e44ad',fontSize:13}}>🖨</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.topBtn,{backgroundColor:t.accent,borderColor:t.accent}]} onPress={()=>onSave(ev)}>
            <Text style={{color:'#fff',fontWeight:'700',fontSize:13}}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:130}}>
        {/* Event Info */}
        <TouchableOpacity style={[s.infoHeader,{backgroundColor:t.card,borderBottomColor:t.border}]} onPress={()=>setShowInfo(!showInfo)}>
          <Text style={{color:t.accent,fontSize:18}}>📋</Text>
          <Text style={{color:t.text,fontWeight:'700',fontSize:14,flex:1,marginLeft:8}}>Event Information</Text>
          <Text style={{color:t.sub}}>{showInfo?'▲':'▼'}</Text>
        </TouchableOpacity>
        {showInfo&&(
          <View style={[s.infoBody,{backgroundColor:t.card,borderColor:t.border}]}>
            <View style={{flexDirection:'row',gap:10}}>
              <View style={{flex:1}}>
                <Text style={[s.label,{color:t.sub}]}>Event Name *</Text>
                <TextInput style={[s.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                  value={ev.eventName} onChangeText={v=>upEv({eventName:v})} placeholder="Event name" placeholderTextColor={t.sub}/>
              </View>
              <View style={{flex:1}}>
                <Sel label="Event Type" value={ev.eventType} options={EVENT_TYPES} onChange={v=>upEv({eventType:v})} isDark={isDark}/>
                <View style={{height:10}}/>
              </View>
            </View>
            <View style={{flexDirection:'row',gap:10}}>
              <View style={{flex:1}}>
                <Text style={[s.label,{color:t.sub}]}>Customer Name</Text>
                <TextInput style={[s.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                  value={ev.customerName} onChangeText={v=>upEv({customerName:v})} placeholder="Customer name" placeholderTextColor={t.sub}/>
              </View>
              <View style={{flex:1}}>
                <Text style={[s.label,{color:t.sub}]}>Mobile</Text>
                <TextInput style={[s.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
                  value={ev.mobile} onChangeText={v=>upEv({mobile:v})} placeholder="Mobile" placeholderTextColor={t.sub} keyboardType="phone-pad"/>
              </View>
            </View>
            <DF label="Event Date" value={ev.eventDate} onChange={v=>upEv({eventDate:v})} isDark={isDark}/>
            <Text style={[s.label,{color:t.sub}]}>Location / Venue</Text>
            <TextInput style={[s.inp,{backgroundColor:t.bg,borderColor:t.border,color:t.text}]}
              value={ev.location} onChangeText={v=>upEv({location:v})} placeholder="Event venue / location" placeholderTextColor={t.sub}/>
          </View>
        )}

        {/* Decor Sections */}
        <View style={{paddingHorizontal:14,marginTop:14}}>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:10}}>
            <Text style={{color:t.text,fontSize:16,fontWeight:'800',flex:1}}>🎨 Decor Sections ({ev.decors.length})</Text>
            <TouchableOpacity style={[s.addSecBtn,{backgroundColor:t.accent,borderColor:t.accent}]} onPress={addDecor}>
              <Text style={{color:'#fff',fontWeight:'700',fontSize:13}}>+ Add Section</Text>
            </TouchableOpacity>
          </View>
          {ev.decors.map((d,i)=>(
            <DecorSectionBlock key={d.id} section={d} idx={i}
              onChange={p=>upDecor(d.id,p)} onDelete={()=>delDecor(d.id)} isDark={isDark}/>
          ))}
        </View>

        {/* Grand Total Panel */}
        <View style={[s.grandPanel,{backgroundColor:t.card,borderColor:t.accent+'30'}]}>
          <Text style={{color:t.accent,fontSize:15,fontWeight:'800',marginBottom:12}}>💎 Event Grand Total</Text>
          {ev.decors.map(d=>(
            <View key={d.id} style={[s.grandRow,{borderBottomColor:t.border}]}>
              <Text style={{color:t.sub,fontSize:12,flex:1}} numberOfLines={1}>{d.heading||'Unnamed Section'}</Text>
              <Text style={{color:t.text,fontSize:12,fontWeight:'600'}}>{fmt(secTotal(d))}</Text>
            </View>
          ))}
          <View style={[s.grandRow,{borderBottomColor:t.border,paddingTop:10}]}>
            <Text style={{color:t.text,fontSize:14,fontWeight:'700',flex:1}}>Total Decoration Cost</Text>
            <Text style={{color:t.accent,fontSize:15,fontWeight:'800'}}>{fmt(grand)}</Text>
          </View>
          <View style={[s.grandRow,{alignItems:'center',borderBottomColor:t.border}]}>
            <Text style={{color:t.sub,fontSize:13,flex:1}}>Advance Amount (₹)</Text>
            <TextInput style={[s.inlineInp,{color:t.text,borderColor:t.border,backgroundColor:t.bg,width:100}]}
              value={ev.advance} onChangeText={v=>upEv({advance:v})} keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}/>
            <Text style={{color:'#27ae60',fontSize:13,fontWeight:'700',minWidth:80,textAlign:'right'}}>{pf(ev.advance)>0?fmt(pf(ev.advance)):'—'}</Text>
          </View>
          <View style={[s.grandRow,{borderBottomWidth:0,paddingTop:10}]}>
            <Text style={{color:bal>0?'#e74c3c':'#27ae60',fontSize:16,fontWeight:'800',flex:1}}>Balance Due</Text>
            <Text style={{color:bal>0?'#e74c3c':'#27ae60',fontSize:18,fontWeight:'800'}}>{fmt(Math.abs(bal))}</Text>
          </View>
          <TouchableOpacity style={[s.saveBtn,{backgroundColor:t.accent,marginTop:14}]} onPress={()=>onSave(ev)}>
            <Text style={s.saveTxt}>💾 Save Event Estimate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.saveBtn,{backgroundColor:'#8e44ad',marginTop:8}]} onPress={handlePrint}>
            <Text style={s.saveTxt}>🖨 Export PDF Quotation</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({events,onAdd,onView,onEdit,onDelete,onPrint,isDark}:{
  events:EventEntry[];onAdd():void;onView(e:EventEntry):void;onEdit(e:EventEntry):void;
  onDelete(id:string):void;onPrint(e:EventEntry):void;isDark:boolean;
}) {
  const t=isDark?DK:LT;
  const [search,setSearch]=useState('');
  const [typeF,setTypeF]=useState('All');
  const [sortK,setSortK]=useState<SortKey>('newest');
  const [showSort,setShowSort]=useState(false);

  const filtered=useMemo(()=>{
    let arr=[...events];
    if(typeF!=='All') arr=arr.filter(e=>e.eventType===typeF);
    if(search) arr=arr.filter(e=>[e.eventName,e.customerName,e.mobile,e.location].some(f=>f.toLowerCase().includes(search.toLowerCase())));
    switch(sortK){
      case 'oldest':      return arr.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      case 'amount-desc': return arr.sort((a,b)=>eventGrandTotal(b)-eventGrandTotal(a));
      case 'amount-asc':  return arr.sort((a,b)=>eventGrandTotal(a)-eventGrandTotal(b));
      case 'name-az':     return arr.sort((a,b)=>a.eventName.localeCompare(b.eventName));
      default:            return arr.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    }
  },[events,typeF,search,sortK]);

  const totalRev=events.reduce((s,e)=>s+eventGrandTotal(e),0);
  const pendingBal=events.reduce((s,e)=>s+Math.max(0,eventBalance(e)),0);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:80}}>
      {/* Summary Strip */}
      <View style={[s.strip,{backgroundColor:t.accent}]}>
        <View style={s.stripItem}>
          <Text style={{color:'#ffffff99',fontSize:11}}>Total Events</Text>
          <Text style={{color:'#fff',fontSize:20,fontWeight:'800'}}>{events.length}</Text>
        </View>
        <View style={[s.stripDiv,{backgroundColor:'#ffffff30'}]}/>
        <View style={s.stripItem}>
          <Text style={{color:'#ffffff99',fontSize:11}}>Total Revenue</Text>
          <Text style={{color:'#fff',fontSize:16,fontWeight:'800'}}>{fmt(totalRev)}</Text>
        </View>
        <View style={[s.stripDiv,{backgroundColor:'#ffffff30'}]}/>
        <View style={s.stripItem}>
          <Text style={{color:'#ffffff99',fontSize:11}}>Balance Pending</Text>
          <Text style={{color:'#FFE4B5',fontSize:16,fontWeight:'800'}}>{fmt(pendingBal)}</Text>
        </View>
      </View>

      {/* Search + Sort */}
      <View style={{paddingHorizontal:14,paddingVertical:10,gap:8}}>
        <View style={{flexDirection:'row',gap:8}}>
          <TextInput style={[s.searchBox,{backgroundColor:t.card,borderColor:t.border,color:t.text,flex:1}]}
            value={search} onChangeText={setSearch} placeholder="Search events, customers..." placeholderTextColor={t.sub}/>
          <TouchableOpacity style={[s.iconBtn2,{backgroundColor:sortK!=='newest'?t.accent:t.card,borderColor:sortK!=='newest'?t.accent:t.border}]} onPress={()=>setShowSort(true)}>
            <Text style={{color:sortK!=='newest'?'#fff':t.sub,fontSize:14}}>⇅</Text>
          </TouchableOpacity>
        </View>
        {/* Type Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {['All',...EVENT_TYPES].map(et=>(
            <TouchableOpacity key={et} style={[s.fChip,{backgroundColor:typeF===et?t.accent:'transparent',borderColor:typeF===et?t.accent:t.border}]}
              onPress={()=>setTypeF(et)}>
              <Text style={{color:typeF===et?'#fff':t.sub,fontSize:11,fontWeight:'600'}}>{et}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{paddingHorizontal:14}}>
        <Text style={{color:t.sub,fontSize:12,marginBottom:8}}>{filtered.length} event{filtered.length!==1?'s':''}</Text>
        {filtered.length===0?(
          <View style={{alignItems:'center',padding:50}}>
            <Text style={{fontSize:48}}>🎉</Text>
            <Text style={{color:t.sub,marginTop:10,fontSize:14}}>No events yet</Text>
            <TouchableOpacity style={[s.saveBtn,{backgroundColor:t.accent,marginTop:16,paddingHorizontal:24}]} onPress={onAdd}>
              <Text style={s.saveTxt}>+ Create First Event</Text>
            </TouchableOpacity>
          </View>
        ):filtered.map(e=>(
          <EventCard key={e.id} event={e} isDark={isDark}
            onView={()=>onView(e)} onEdit={()=>onEdit(e)}
            onDelete={()=>onDelete(e.id)} onPrint={()=>onPrint(e)}/>
        ))}
      </View>
      <SortModal visible={showSort} current={sortK} onSelect={setSortK} onClose={()=>setShowSort(false)} isDark={isDark}/>
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function GroupsScreen() {
  const scheme=useColorScheme();
  const [isDark,setIsDark]=useState(scheme==='dark');
  const t=isDark?DK:LT;
  const [view,setView]=useState<AppView>('dashboard');
  const [events,setEvents]=useState<EventEntry[]>([]);
  const [loading,setLoading]=useState(true);
  const [activeEvent,setActiveEvent]=useState<EventEntry|null>(null);

  const loadEvents=useCallback(async()=>{
    try{
      const data=await eventsApi.getAll();
      setEvents(data.map(fromApi));
    }catch(e:any){
      Alert.alert('Error','Could not load events: '+e.message);
    }finally{setLoading(false);}
  },[]);

  useEffect(()=>{loadEvents();},[loadEvents]);

  function openNew(){setActiveEvent(emptyEvent());setView('detail');}
  function openView(e:EventEntry){setActiveEvent({...e});setView('detail');}
  function openEdit(e:EventEntry){setActiveEvent({...e});setView('detail');}

  async function handleSave(updated:EventEntry){
    try{
      const payload=toPayload(updated);
      const exists=events.find(e=>e.id===updated.id);
      if(exists){
        const saved=await eventsApi.update(updated.id,payload);
        setEvents(prev=>prev.map(e=>e.id===updated.id?fromApi(saved):e));
      } else {
        const created=await eventsApi.create(payload);
        setEvents(prev=>[fromApi(created),...prev]);
      }
      setView('dashboard');setActiveEvent(null);
    }catch(e:any){Alert.alert('Error',e.message);}
  }

  function handleDelete(id:string){
    const del=async()=>{
      try{
        await eventsApi.remove(id);
        setEvents(prev=>prev.filter(e=>e.id!==id));
      }catch(e:any){Alert.alert('Error',e.message);}
    };
    Platform.OS==='web'?window.confirm('Delete this event?')&&del():Alert.alert('Delete','Delete this event?',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:del}]);
  }

  async function handlePrint(ev:EventEntry){
    const secHtml=ev.decors.map(d=>{
      const rows=d.items.filter(i=>i.name).map(i=>
        `<tr><td>${i.name}</td><td align="center">${pi(i.qty)}</td><td align="right">₹${pf(i.unitCost).toLocaleString('en-IN')}</td>
         <td align="right">₹${(pi(i.qty)*pf(i.unitCost)).toLocaleString('en-IN')}</td></tr>`).join('');
      return `<div style="margin-top:14px;border:1px solid #e0d0ff;border-radius:8px;overflow:hidden">
        <div style="background:#7C3AED;color:white;padding:8px 12px;font-weight:700">${d.heading||'Decor Section'}</div>
        <table width="100%" cellpadding="7" style="border-collapse:collapse">
          <tr style="background:#f8f4ff"><th align="left">Item</th><th align="center">Qty</th><th align="right">Unit</th><th align="right">Total</th></tr>
          ${rows}</table>
        <div style="padding:8px 12px;text-align:right;background:#faf8ff">
          Section Total: <b style="color:#7C3AED">₹${secTotal(d).toLocaleString('en-IN')}</b></div></div>`;
    }).join('');
    const grand=eventGrandTotal(ev);
    const bal=eventBalance(ev);
    const html=`<html><body style="font-family:sans-serif;padding:24px;max-width:680px;margin:auto">
      <div style="background:linear-gradient(135deg,#7C3AED,#a855f7);color:white;padding:20px;border-radius:12px">
        <h2 style="margin:0 0 6px 0">${ev.eventName||'Event Estimate'}</h2>
        <p style="margin:2px 0;opacity:.9">${ev.customerName} · ${ev.mobile}</p>
        <p style="margin:2px 0;opacity:.9">${ev.eventType} · ${ev.eventDate} · ${ev.location}</p>
      </div>
      ${secHtml}
      <div style="margin-top:18px;border:2px solid #7C3AED;border-radius:12px;padding:16px;background:#faf8ff">
        <h3 style="color:#7C3AED;margin:0 0 10px">Grand Total</h3>
        <table width="100%" style="font-size:14px">
          <tr><td>Total Decoration Cost</td><td align="right"><b>₹${grand.toLocaleString('en-IN')}</b></td></tr>
          <tr><td>Advance Paid</td><td align="right" style="color:green"><b>₹${pf(ev.advance).toLocaleString('en-IN')}</b></td></tr>
          <tr style="font-size:16px;border-top:1px solid #ddd">
            <td><b>Balance Due</b></td>
            <td align="right"><b style="color:${bal>0?'#e74c3c':'#27ae60'}">₹${Math.abs(bal).toLocaleString('en-IN')}</b></td>
          </tr></table>
      </div>
      <p style="text-align:center;color:#aaa;font-size:11px;margin-top:14px">Generated by A1 Groups App · ${TODAY}</p>
    </body></html>`;
    try{const{uri}=await Print.printToFileAsync({html});await Sharing.shareAsync(uri);}catch{}
  }

  if(loading) return (
    <SafeAreaView style={[s.safe,{backgroundColor:t.bg,alignItems:'center',justifyContent:'center'}]}>
      <Text style={{color:t.sub,fontSize:15}}>Loading events...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[s.safe,{backgroundColor:t.bg}]}>
      <StatusBar barStyle={isDark?'light-content':'dark-content'}/>
      {view==='dashboard'&&(
        <>
          <View style={[s.header,{backgroundColor:t.card,borderBottomColor:t.border}]}>
            <View>
              <Text style={[s.headerTitle,{color:t.text}]}>Event Estimates</Text>
              <Text style={{color:t.sub,fontSize:11}}>Decor Quotation Management</Text>
            </View>
            <View style={{flexDirection:'row',gap:8}}>
              <TouchableOpacity style={[s.iconBtn2,{backgroundColor:isDark?'#fff1':'#7C3AED11',borderColor:t.border}]} onPress={()=>setIsDark(!isDark)}>
                <Text>{isDark?'☀️':'🌙'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.addEvtBtn,{backgroundColor:t.accent}]} onPress={openNew}>
                <Text style={{color:'#fff',fontWeight:'800',fontSize:13}}>+ New Event</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Dashboard events={events} isDark={isDark} onAdd={openNew}
            onView={openView} onEdit={openEdit} onDelete={handleDelete} onPrint={handlePrint}/>
        </>
      )}
      {view==='detail'&&activeEvent&&(
        <EventDetailView initial={activeEvent} isDark={isDark}
          onBack={()=>{setView('dashboard');setActiveEvent(null);}} onSave={handleSave}/>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s=StyleSheet.create({
  safe:         {flex:1},
  header:       {flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12,borderBottomWidth:1},
  headerTitle:  {fontSize:20,fontWeight:'800'},
  addEvtBtn:    {paddingHorizontal:14,paddingVertical:8,borderRadius:9},
  iconBtn2:     {width:38,height:38,borderRadius:9,borderWidth:1,alignItems:'center',justifyContent:'center'},
  strip:        {flexDirection:'row',paddingVertical:14,paddingHorizontal:16},
  stripItem:    {flex:1,alignItems:'center'},
  stripDiv:     {width:1,marginVertical:4},
  searchBox:    {padding:10,borderRadius:9,borderWidth:1,fontSize:14},
  fChip:        {paddingHorizontal:12,paddingVertical:5,borderRadius:16,borderWidth:1,marginRight:7},
  eCard:        {borderRadius:14,borderWidth:1,marginBottom:14,overflow:'hidden'},
  eCardThumb:   {width:'100%',height:140,backgroundColor:'#1a1a2e'},
  eCardBadge:   {position:'absolute',top:8,right:8,paddingHorizontal:9,paddingVertical:3,borderRadius:8,borderWidth:1},
  cardBtn:      {paddingVertical:8,borderRadius:8,borderWidth:1,alignItems:'center'},
  detailBar:    {flexDirection:'row',alignItems:'center',padding:12,borderBottomWidth:1},
  backBtn:      {paddingHorizontal:4,paddingVertical:4},
  topBtn:       {paddingHorizontal:12,paddingVertical:7,borderRadius:8,borderWidth:1},
  infoHeader:   {flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12,borderBottomWidth:1},
  infoBody:     {paddingHorizontal:14,paddingTop:12,paddingBottom:4,borderBottomWidth:1,borderColor:'transparent'},
  addSecBtn:    {paddingHorizontal:12,paddingVertical:7,borderRadius:8},
  secBlock:     {borderRadius:14,borderWidth:1,marginBottom:12,overflow:'hidden'},
  secHeader:    {flexDirection:'row',alignItems:'center',padding:12,borderBottomWidth:1,gap:8},
  secNum:       {width:26,height:26,borderRadius:8,alignItems:'center',justifyContent:'center'},
  secHeadInput: {flex:1,fontSize:14,fontWeight:'700',paddingVertical:0},
  itemRow:      {borderRadius:9,borderWidth:1,padding:10,marginBottom:8},
  addItemBtn:   {borderWidth:1.5,borderRadius:9,padding:10,alignItems:'center',marginVertical:6},
  secTotals:    {borderRadius:10,borderWidth:1,padding:12,marginTop:4},
  totRow:       {flexDirection:'row',justifyContent:'space-between',paddingVertical:5},
  grandPanel:   {margin:14,borderRadius:14,borderWidth:2,padding:16,marginTop:4},
  grandRow:     {flexDirection:'row',justifyContent:'space-between',paddingVertical:7,borderBottomWidth:1},
  overlay:      {flex:1,backgroundColor:'#00000080',justifyContent:'flex-end'},
  sheet:        {borderTopLeftRadius:20,borderTopRightRadius:20,padding:18},
  sheetTitle:   {fontSize:18,fontWeight:'700'},
  label:        {fontSize:12,fontWeight:'600',marginBottom:4},
  trigger:      {flexDirection:'row',alignItems:'center',padding:11,borderRadius:8,borderWidth:1,marginBottom:0},
  selPanel:     {margin:20,borderRadius:12,borderWidth:1,padding:12},
  selSearch:    {padding:9,borderRadius:8,borderWidth:1,marginBottom:8},
  selOpt:       {padding:12,borderRadius:6},
  inp:          {padding:11,borderRadius:8,borderWidth:1,marginBottom:10,fontSize:14},
  miniInp:      {padding:9,borderRadius:7,borderWidth:1,fontSize:13,height:38},
  inlineInp:    {padding:7,borderRadius:7,borderWidth:1,fontSize:13,minWidth:70,textAlign:'right'},
  thumb:        {width:80,height:80,borderRadius:10},
  thumbDel:     {position:'absolute',top:2,right:2,width:18,height:18,borderRadius:9,backgroundColor:'#e74c3c',alignItems:'center',justifyContent:'center'},
  thumbAdd:     {width:80,height:80,borderRadius:10,borderWidth:2,borderStyle:'dashed',alignItems:'center',justifyContent:'center'},
  saveBtn:      {padding:14,borderRadius:10,alignItems:'center'},
  saveTxt:      {color:'#fff',fontWeight:'700',fontSize:15},
  carWrap:      {borderRadius:12,borderWidth:1,overflow:'hidden',marginBottom:6,position:'relative'},
  carMain:      {width:'100%',height:220,backgroundColor:'#1a1a2e'},
  carEmpty:     {height:100,borderRadius:12,borderWidth:2,borderStyle:'dashed',alignItems:'center',justifyContent:'center',marginBottom:12},
  carDel:       {position:'absolute',top:8,right:8,width:32,height:32,borderRadius:16,backgroundColor:'#e74c3ccc',alignItems:'center',justifyContent:'center'},
  carCounter:   {position:'absolute',top:8,left:8,backgroundColor:'#00000070',paddingHorizontal:8,paddingVertical:3,borderRadius:10},
  carAddMore:   {position:'absolute',bottom:8,right:8,backgroundColor:'#00000070',paddingHorizontal:10,paddingVertical:5,borderRadius:10},
  carArrow:     {position:'absolute',top:0,bottom:0,width:36,alignItems:'center',justifyContent:'center',backgroundColor:'#00000030'},
  carDots:      {position:'absolute',bottom:10,left:0,right:0,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:5},
  carDot:       {height:6,borderRadius:3,backgroundColor:'#fff'},
  carThumb:     {width:52,height:52,borderRadius:8,backgroundColor:'#1a1a2e'},
});
