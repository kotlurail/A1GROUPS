import {
  Alert, Dimensions, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, SafeAreaView,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { employeesApi } from '../../lib/api';

const SCREEN_H = Dimensions.get('window').height;

// ── Types ──────────────────────────────────────────────────────────────────────
type AttendanceStatus = 'present' | 'absent' | 'half' | 'holiday';

interface AttendanceRecord { date: string; status: AttendanceStatus; }

interface CashEntry {
  id: string; date: string; amount: number; note: string;
  type: 'advance' | 'salary' | 'deduction';
}

interface Employee {
  id: string; name: string; role: string; phone: string;
  monthlySalary: number; workingDays: number; joinDate: string;
  periodStart: string; periodEnd: string;
  attendance: AttendanceRecord[]; cashEntries: CashEntry[];
}

// ── Constants ──────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const SHORT_DAY = ['S','M','T','W','T','F','S'];
const STATUS_COLOR: Record<AttendanceStatus,string> = {
  present:'#27ae60', absent:'#e74c3c', half:'#f39c12', holiday:'#7f8c8d',
};
const STATUS_LABEL: Record<AttendanceStatus,string> = {
  present:'P', absent:'A', half:'½', holiday:'H',
};
const CYCLE: (AttendanceStatus|undefined)[] = ['present','absent','half','holiday',undefined];

// ── Helpers ────────────────────────────────────────────────────────────────────
function daysInMonth(year:number,month:number){return new Date(year,month+1,0).getDate();}
function firstDayOfMonth(year:number,month:number){return new Date(year,month,1).getDay();}
function toDateStr(year:number,month:number,day:number){
  return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function fmtMoney(n:number){return '₹'+n.toLocaleString('en-IN');}
function nowDate(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isValidDate(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s).getTime());}
function nextStatus(cur:AttendanceStatus|undefined):AttendanceStatus|undefined{
  return CYCLE[(CYCLE.indexOf(cur)+1)%CYCLE.length];
}
function attForMonth(emp:Employee,year:number,month:number):Record<string,AttendanceStatus>{
  const map:Record<string,AttendanceStatus>={};
  emp.attendance.forEach(a=>{
    const d=new Date(a.date);
    if(d.getFullYear()===year&&d.getMonth()===month) map[a.date]=a.status;
  });
  return map;
}
function countByStatus(emp:Employee,year:number,month:number){
  const map=attForMonth(emp,year,month);
  let present=0,absent=0,half=0,holiday=0;
  Object.values(map).forEach(s=>{
    if(s==='present') present++;
    else if(s==='absent') absent++;
    else if(s==='half') half++;
    else holiday++;
  });
  return {present,absent,half,holiday};
}
function earnedSalary(emp:Employee,year:number,month:number):number{
  const {present,half}=countByStatus(emp,year,month);
  return Math.round(((present+half*0.5)/emp.workingDays)*emp.monthlySalary);
}
function cashForMonth(emp:Employee,year:number,month:number){
  return emp.cashEntries.filter(c=>{
    const d=new Date(c.date);
    return d.getFullYear()===year&&d.getMonth()===month;
  });
}
function sumByType(emp:Employee,year:number,month:number,type:CashEntry['type']):number{
  return cashForMonth(emp,year,month).filter(c=>c.type===type).reduce((s,c)=>s+c.amount,0);
}
function balanceDue(emp:Employee,year:number,month:number):number{
  return earnedSalary(emp,year,month)
    -sumByType(emp,year,month,'advance')
    -sumByType(emp,year,month,'deduction')
    -sumByType(emp,year,month,'salary');
}

function normalizeEmployee(e:any):Employee{
  return {
    ...e,
    id: e._id??e.id,
    cashEntries:(e.cashEntries??[]).map((c:any)=>({...c,id:c._id??c.id})),
  };
}

// ── Cross-platform Date Picker ─────────────────────────────────────────────────
let RNDateTimePicker:any=null;
if(Platform.OS!=='web'){
  RNDateTimePicker=require('@react-native-community/datetimepicker').default;
}

function DatePickerField({value,onChange,style}:{value:string;onChange:(d:string)=>void;style?:any}){
  const [show,setShow]=useState(false);
  const dateObj=isValidDate(value)?new Date(value+'T12:00:00'):new Date();
  const base={backgroundColor:'#F7F5FF',borderRadius:10,borderWidth:1,borderColor:'rgba(123,97,255,0.15)',overflow:'hidden' as const};
  if(Platform.OS==='web'){
    return(
      <View style={[base,style]}>
        <input type="date" value={value} onChange={(e:any)=>onChange(e.target.value)}
          style={{border:'none',background:'transparent',fontSize:14,color:value?'#1A1A2E':'#9B98C0',width:'100%',padding:'10px 12px',fontFamily:'inherit',outline:'none',boxSizing:'border-box'} as any}/>
      </View>
    );
  }
  return(
    <>
      <TouchableOpacity style={[base,{paddingHorizontal:12,paddingVertical:12,justifyContent:'center'},style]} onPress={()=>setShow(true)} activeOpacity={0.7}>
        <Text style={{fontSize:14,color:value?'#1A1A2E':'#9B98C0'}}>{value||'Select date'}</Text>
      </TouchableOpacity>
      {show&&RNDateTimePicker&&(
        <RNDateTimePicker value={dateObj} mode="date" display="default"
          onChange={(_:any,date?:Date)=>{
            setShow(false);
            if(date) onChange(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
          }}/>
      )}
    </>
  );
}

// ── Attendance Calendar ────────────────────────────────────────────────────────
function AttendanceCalendar({year,month,attMap,onToggle,onPrev,onNext}:{
  year:number;month:number;attMap:Record<string,AttendanceStatus>;
  onToggle:(date:string)=>void;onPrev:()=>void;onNext:()=>void;
}){
  const totalDays=daysInMonth(year,month);
  const startDay=firstDayOfMonth(year,month);
  const todayStr=nowDate();
  const cells:(number|null)[]=[...Array(startDay).fill(null),...Array.from({length:totalDays},(_,i)=>i+1)];
  while(cells.length%7!==0) cells.push(null);
  return(
    <View style={att.container}>
      <View style={att.header}>
        <TouchableOpacity onPress={onPrev} style={att.navBtn}><Text style={att.navTxt}>{'<'}</Text></TouchableOpacity>
        <Text style={att.title}>{MONTH_NAMES[month]} {year}</Text>
        <TouchableOpacity onPress={onNext} style={att.navBtn}><Text style={att.navTxt}>{'>'}</Text></TouchableOpacity>
      </View>
      <View style={att.dayRow}>
        {SHORT_DAY.map((d,i)=><Text key={i} style={att.dayName}>{d}</Text>)}
      </View>
      {Array.from({length:cells.length/7},(_,row)=>(
        <View key={row} style={att.weekRow}>
          {cells.slice(row*7,row*7+7).map((day,col)=>{
            if(!day) return <View key={col} style={att.cell}/>;
            const dateStr=toDateStr(year,month,day);
            const status=attMap[dateStr];
            const isToday=dateStr===todayStr;
            const isFuture=dateStr>todayStr;
            return(
              <TouchableOpacity key={col}
                style={[att.cell,status&&{backgroundColor:STATUS_COLOR[status]+'22',borderColor:STATUS_COLOR[status]+'66'},isToday&&!status&&att.todayCell]}
                onPress={()=>!isFuture&&onToggle(dateStr)} activeOpacity={isFuture?1:0.7}>
                <Text style={[att.dayNum,status&&{color:STATUS_COLOR[status],fontWeight:'700'},isToday&&!status&&att.todayNum]}>{day}</Text>
                {status?<Text style={[att.statusLbl,{color:STATUS_COLOR[status]}]}>{STATUS_LABEL[status]}</Text>:null}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
      <View style={att.legend}>
        {(Object.entries(STATUS_COLOR) as [AttendanceStatus,string][]).map(([s,c])=>(
          <View key={s} style={att.legendItem}>
            <View style={[att.legendDot,{backgroundColor:c}]}/>
            <Text style={att.legendTxt}>{s==='half'?'Half Day':s.charAt(0).toUpperCase()+s.slice(1)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Employee Card ──────────────────────────────────────────────────────────────
function EmployeeCard({emp,year,month,onPress}:{emp:Employee;year:number;month:number;onPress:()=>void}){
  const counts=countByStatus(emp,year,month);
  const earned=earnedSalary(emp,year,month);
  const adv=sumByType(emp,year,month,'advance');
  const ded=sumByType(emp,year,month,'deduction');
  const paid=sumByType(emp,year,month,'salary');
  const bal=earned-adv-ded-paid;
  return(
    <TouchableOpacity style={ec.card} onPress={onPress} activeOpacity={0.85}>
      <View style={ec.topRow}>
        <View style={{flex:1}}>
          <Text style={ec.name}>{emp.name}</Text>
          <Text style={ec.role}>{emp.role}</Text>
          {emp.phone?<Text style={ec.phone}>{emp.phone}</Text>:null}
        </View>
        <View style={ec.salaryBadge}>
          <Text style={ec.salaryAmt}>{fmtMoney(emp.monthlySalary)}</Text>
          <Text style={ec.salaryLabel}>/month</Text>
        </View>
      </View>
      <View style={ec.attRow}>
        {([['present',counts.present,'Present'],['absent',counts.absent,'Absent'],['half',counts.half,'Half'],['holiday',counts.holiday,'Holiday']] as [AttendanceStatus,number,string][]).map(([s,n,label])=>(
          <View key={s} style={[ec.attChip,{backgroundColor:STATUS_COLOR[s]+'22'}]}>
            <Text style={[ec.attNum,{color:STATUS_COLOR[s]}]}>{n}</Text>
            <Text style={[ec.attLbl,{color:STATUS_COLOR[s]}]}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={ec.finRow}>
        {[['Earned',fmtMoney(earned),'#1a1a2e'],['Advance',fmtMoney(adv+ded),'#e67e22'],['Paid',fmtMoney(paid),'#27ae60'],['Balance',fmtMoney(bal),bal>=0?'#2980b9':'#e74c3c']].map(([label,val,color])=>(
          <View key={label} style={ec.finItem}>
            <Text style={ec.finLabel}>{label}</Text>
            <Text style={[ec.finVal,{color}]}>{val}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

// ── Add Employee Modal ─────────────────────────────────────────────────────────
function AddEmployeeModal({onClose,onAdd}:{onClose:()=>void;onAdd:(e:Employee)=>void}){
  const today=nowDate();
  const yr=today.substring(0,4),mo=today.substring(5,7);
  const [name,setName]=useState('');
  const [role,setRole]=useState('');
  const [phone,setPhone]=useState('');
  const [salary,setSalary]=useState('');
  const [wdays,setWdays]=useState('26');
  const [joinDate,setJoinDate]=useState(today);
  const [pStart,setPStart]=useState(`${yr}-${mo}-01`);
  const [pEnd,setPEnd]=useState(`${yr}-${mo}-${daysInMonth(Number(yr),Number(mo)-1).toString().padStart(2,'0')}`);
  const [saving,setSaving]=useState(false);

  async function handleAdd(){
    if(!name.trim()) return Alert.alert('Required','Enter employee name.');
    if(!role.trim()) return Alert.alert('Required','Enter role.');
    if(!salary||isNaN(Number(salary))||Number(salary)<=0) return Alert.alert('Required','Enter a valid monthly salary.');
    setSaving(true);
    try{
      const created=await employeesApi.create({
        name:name.trim(),role:role.trim(),phone:phone.trim(),
        monthlySalary:Number(salary),workingDays:Number(wdays)||26,
        joinDate,periodStart:pStart,periodEnd:pEnd,attendance:[],cashEntries:[],
      });
      onAdd(normalizeEmployee(created));
      onClose();
    }catch(e:any){Alert.alert('Error',e.message);}
    finally{setSaving(false);}
  }

  return(
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={sh.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1}/>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%',maxHeight:'92%'}}>
          <View style={[sh.sheet,{flex:1}]}>
            <View style={sh.handle}/>
            <View style={sh.header}>
              <Text style={sh.title}>Add Employee</Text>
              <TouchableOpacity onPress={onClose}><Text style={sh.close}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}} keyboardShouldPersistTaps="handled">
              <Text style={sh.label}>Full Name *</Text>
              <TextInput style={sh.input} placeholder="e.g. Ramu" value={name} onChangeText={setName}/>
              <Text style={sh.label}>Role *</Text>
              <TextInput style={sh.input} placeholder="e.g. Hall Manager" value={role} onChangeText={setRole}/>
              <Text style={sh.label}>Phone</Text>
              <TextInput style={sh.input} placeholder="10-digit mobile" keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={10}/>
              <Text style={sh.label}>Monthly Salary (₹) *</Text>
              <TextInput style={sh.input} placeholder="e.g. 15000" keyboardType="number-pad" value={salary} onChangeText={setSalary}/>
              <Text style={sh.label}>Working Days per Month</Text>
              <TextInput style={sh.input} placeholder="26" keyboardType="number-pad" value={wdays} onChangeText={setWdays}/>
              <Text style={sh.label}>Join Date</Text>
              <DatePickerField value={joinDate} onChange={setJoinDate}/>
              <Text style={[sh.label,{marginTop:20,fontSize:13,color:'#1A1A2E'}]}>Salary Period</Text>
              <Text style={sh.label}>Period Start</Text>
              <DatePickerField value={pStart} onChange={setPStart}/>
              <Text style={sh.label}>Period End</Text>
              <DatePickerField value={pEnd} onChange={setPEnd}/>
              <View style={sh.actionRow}>
                <TouchableOpacity style={sh.cancelBtn} onPress={onClose}><Text style={sh.cancelTxt}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[sh.saveBtn,saving&&{opacity:0.6}]} onPress={handleAdd} disabled={saving}>
                  <Text style={sh.saveTxt}>{saving?'Saving…':'Add Employee'}</Text>
                </TouchableOpacity>
              </View>
              <View style={{height:32}}/>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Employee Detail Modal ──────────────────────────────────────────────────────
function EmployeeDetailModal({employee:init,year,month,onClose,onUpdate,onDelete}:{
  employee:Employee;year:number;month:number;
  onClose:()=>void;onUpdate:(e:Employee)=>void;onDelete:(id:string)=>void;
}){
  const [emp,setEmp]=useState<Employee>(init);
  const [isEditing,setIsEditing]=useState(false);
  const [calYear,setCalYear]=useState(year);
  const [calMonth,setCalMonth]=useState(month);

  const [cashType,setCashType]=useState<CashEntry['type']>('advance');
  const [cashAmt,setCashAmt]=useState('');
  const [cashNote,setCashNote]=useState('');
  const [cashDate,setCashDate]=useState(nowDate());

  const [editName,setEditName]=useState(init.name);
  const [editRole,setEditRole]=useState(init.role);
  const [editPhone,setEditPhone]=useState(init.phone);
  const [editSalary,setEditSalary]=useState(init.monthlySalary.toString());
  const [editWdays,setEditWdays]=useState(init.workingDays.toString());
  const [editPStart,setEditPStart]=useState(init.periodStart);
  const [editPEnd,setEditPEnd]=useState(init.periodEnd);

  function applyUpdate(raw:any){
    const updated=normalizeEmployee(raw);
    setEmp(updated);
    onUpdate(updated);
    return updated;
  }

  async function toggleAttendance(date:string){
    const existing=emp.attendance.find(a=>a.date===date);
    const next=nextStatus(existing?.status);
    try{
      const raw=await employeesApi.patchAttendance(emp.id,date,next??null);
      applyUpdate(raw);
    }catch(e:any){Alert.alert('Error',e.message);}
  }

  async function addCashEntry(){
    if(!cashAmt||isNaN(Number(cashAmt))||Number(cashAmt)<=0)
      return Alert.alert('Invalid','Enter a valid amount.');
    try{
      const raw=await employeesApi.addCash(emp.id,{
        date:cashDate,amount:Number(cashAmt),note:cashNote.trim(),type:cashType,
      });
      applyUpdate(raw);
      setCashAmt('');setCashNote('');
    }catch(e:any){Alert.alert('Error',e.message);}
  }

  async function removeCashEntry(cashId:string){
    try{
      const raw=await employeesApi.removeCash(emp.id,cashId);
      applyUpdate(raw);
    }catch(e:any){Alert.alert('Error',e.message);}
  }

  async function saveEdits(){
    if(!editName.trim()) return Alert.alert('Required','Enter name.');
    if(!editRole.trim()) return Alert.alert('Required','Enter role.');
    if(!editSalary||isNaN(Number(editSalary))) return Alert.alert('Required','Enter valid salary.');
    try{
      const raw=await employeesApi.update(emp.id,{
        name:editName.trim(),role:editRole.trim(),phone:editPhone.trim(),
        monthlySalary:Number(editSalary),workingDays:Number(editWdays)||26,
        periodStart:editPStart,periodEnd:editPEnd,
      });
      applyUpdate(raw);
      setIsEditing(false);
    }catch(e:any){Alert.alert('Error',e.message);}
  }

  function confirmDelete(){
    Alert.alert('Delete Employee',`Remove ${emp.name}? This cannot be undone.`,[
      {text:'Cancel',style:'cancel'},
      {text:'Delete',style:'destructive',onPress:async()=>{
        try{
          await employeesApi.remove(emp.id);
          onDelete(emp.id);
          onClose();
        }catch(e:any){Alert.alert('Error',e.message);}
      }},
    ]);
  }

  function prevMonth(){if(calMonth===0){setCalYear(y=>y-1);setCalMonth(11);}else setCalMonth(m=>m-1);}
  function nextMonth(){if(calMonth===11){setCalYear(y=>y+1);setCalMonth(0);}else setCalMonth(m=>m+1);}

  const attMap=attForMonth(emp,calYear,calMonth);
  const counts=countByStatus(emp,calYear,calMonth);
  const earned=earnedSalary(emp,calYear,calMonth);
  const adv=sumByType(emp,calYear,calMonth,'advance');
  const ded=sumByType(emp,calYear,calMonth,'deduction');
  const paid=sumByType(emp,calYear,calMonth,'salary');
  const bal=earned-adv-ded-paid;
  const perDay=Math.round(emp.monthlySalary/emp.workingDays);
  const monthEntries=cashForMonth(emp,calYear,calMonth);
  const effectiveDays=counts.present+counts.half*0.5;

  if(isEditing){
    return(
      <Modal transparent animationType="slide" onRequestClose={()=>setIsEditing(false)}>
        <View style={sh.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={()=>setIsEditing(false)} activeOpacity={1}/>
          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%',maxHeight:'92%'}}>
            <View style={[sh.sheet,{flex:1}]}>
              <View style={sh.handle}/>
              <View style={sh.header}>
                <Text style={sh.title}>Edit Employee</Text>
                <TouchableOpacity onPress={()=>setIsEditing(false)}><Text style={sh.close}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}} keyboardShouldPersistTaps="handled">
                <Text style={sh.label}>Full Name *</Text>
                <TextInput style={sh.input} value={editName} onChangeText={setEditName}/>
                <Text style={sh.label}>Role *</Text>
                <TextInput style={sh.input} value={editRole} onChangeText={setEditRole}/>
                <Text style={sh.label}>Phone</Text>
                <TextInput style={sh.input} keyboardType="phone-pad" value={editPhone} onChangeText={setEditPhone} maxLength={10}/>
                <Text style={sh.label}>Monthly Salary (₹) *</Text>
                <TextInput style={sh.input} keyboardType="number-pad" value={editSalary} onChangeText={setEditSalary}/>
                <Text style={sh.label}>Working Days per Month</Text>
                <TextInput style={sh.input} keyboardType="number-pad" value={editWdays} onChangeText={setEditWdays}/>
                <Text style={[sh.label,{marginTop:20,fontSize:13,color:'#1A1A2E',textTransform:'none',letterSpacing:0}]}>Salary Period</Text>
                <Text style={sh.label}>Period Start</Text>
                <DatePickerField value={editPStart} onChange={setEditPStart}/>
                <Text style={sh.label}>Period End</Text>
                <DatePickerField value={editPEnd} onChange={setEditPEnd}/>
                <View style={sh.actionRow}>
                  <TouchableOpacity style={sh.cancelBtn} onPress={()=>setIsEditing(false)}><Text style={sh.cancelTxt}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={sh.saveBtn} onPress={saveEdits}><Text style={sh.saveTxt}>Save Changes</Text></TouchableOpacity>
                </View>
                <View style={{height:32}}/>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
  }

  return(
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={det.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1}/>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%',maxHeight:'94%'}}>
          <View style={[det.sheet,{flex:1}]}>
            <View style={det.handle}/>
            <ScrollView style={{flex:1}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <View style={det.titleRow}>
                <View style={{flex:1}}>
                  <Text style={det.title}>{emp.name}</Text>
                  <Text style={det.subtitle}>{emp.role}{emp.phone?`  ·  ${emp.phone}`:''}</Text>
                  <Text style={det.period}>Period: {emp.periodStart} → {emp.periodEnd}</Text>
                </View>
                <TouchableOpacity style={det.editBtn} onPress={()=>setIsEditing(true)}>
                  <Text style={det.editBtnTxt}>Edit</Text>
                </TouchableOpacity>
              </View>

              <View style={det.chipRow}>
                {[['Monthly',fmtMoney(emp.monthlySalary)],['Per Day',fmtMoney(perDay)],['Working Days',`${emp.workingDays} days`]].map(([label,val])=>(
                  <View key={label} style={det.chip}>
                    <Text style={det.chipLabel}>{label}</Text>
                    <Text style={det.chipVal}>{val}</Text>
                  </View>
                ))}
              </View>

              <View style={det.card}>
                <Text style={det.cardTitle}>📅 Attendance</Text>
                <Text style={det.cardHint}>Tap a day to cycle:  Present → Absent → Half Day → Holiday → Clear</Text>
                <AttendanceCalendar year={calYear} month={calMonth} attMap={attMap}
                  onToggle={toggleAttendance} onPrev={prevMonth} onNext={nextMonth}/>
                <View style={det.attCountRow}>
                  {([['present',counts.present,'Present'],['absent',counts.absent,'Absent'],['half',counts.half,'Half Day'],['holiday',counts.holiday,'Holiday']] as [AttendanceStatus,number,string][]).map(([s,n,label])=>(
                    <View key={s} style={[det.attCountChip,{backgroundColor:STATUS_COLOR[s]+'15',borderColor:STATUS_COLOR[s]+'40'}]}>
                      <Text style={[det.attCountNum,{color:STATUS_COLOR[s]}]}>{n}</Text>
                      <Text style={[det.attCountLabel,{color:STATUS_COLOR[s]}]}>{label}</Text>
                    </View>
                  ))}
                </View>
                <View style={det.earnedBox}>
                  <View style={det.earnedRow}>
                    <Text style={det.earnedLabel}>Effective Days</Text>
                    <Text style={det.earnedVal}>{effectiveDays} / {emp.workingDays}</Text>
                  </View>
                  <View style={det.earnedRow}>
                    <Text style={det.earnedLabel}>Earned This Month</Text>
                    <Text style={[det.earnedVal,{color:'#7B61FF',fontWeight:'800',fontSize:16}]}>{fmtMoney(earned)}</Text>
                  </View>
                </View>
              </View>

              <View style={det.card}>
                <Text style={det.cardTitle}>💵 Cash Given & Salary</Text>
                <Text style={det.cardHint}>Daily advances, deductions, and salary payments for {MONTH_NAMES[calMonth]} {calYear}</Text>
                {monthEntries.length===0?(
                  <Text style={det.emptyHint}>No entries for this month</Text>
                ):(
                  <View style={{marginTop:8}}>
                    {monthEntries.map(c=>(
                      <View key={c.id} style={det.cashItem}>
                        <View style={[det.cashDot,{backgroundColor:c.type==='salary'?'#27ae60':c.type==='deduction'?'#e74c3c':'#e67e22'}]}/>
                        <View style={{flex:1}}>
                          <Text style={det.cashNote}>{c.note||(c.type.charAt(0).toUpperCase()+c.type.slice(1))}</Text>
                          <Text style={det.cashMeta}>{c.date}  ·  {c.type==='advance'?'Advance':c.type==='deduction'?'Deduction':'Salary'}</Text>
                        </View>
                        <Text style={[det.cashAmt,{color:c.type==='salary'?'#27ae60':'#e67e22'}]}>
                          {c.type==='salary'?'+':'−'} {fmtMoney(c.amount)}
                        </Text>
                        <TouchableOpacity onPress={()=>removeCashEntry(c.id)} style={det.delBtn}>
                          <Text style={det.delTxt}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{marginTop:14}}>
                  <Text style={det.inputLabel}>Type</Text>
                  <View style={det.typeRow}>
                    {([['advance','💵 Advance'],['deduction','➖ Deduction'],['salary','✅ Salary Paid']] as [CashEntry['type'],string][]).map(([t,label])=>(
                      <TouchableOpacity key={t}
                        style={[det.typeChip,cashType===t&&det.typeChipActive,cashType===t&&t==='salary'&&{backgroundColor:'#27ae60',borderColor:'#27ae60'},cashType===t&&t==='deduction'&&{backgroundColor:'#e74c3c',borderColor:'#e74c3c'}]}
                        onPress={()=>setCashType(t)}>
                        <Text style={[det.typeChipTxt,cashType===t&&{color:'#fff'}]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={det.inputLabel}>Date</Text>
                  <DatePickerField value={cashDate} onChange={setCashDate}/>
                  <Text style={det.inputLabel}>Amount (₹)</Text>
                  <TextInput style={det.input} placeholder="e.g. 500" keyboardType="number-pad" value={cashAmt} onChangeText={setCashAmt}/>
                  <Text style={det.inputLabel}>Note (optional)</Text>
                  <TextInput style={det.input} placeholder="e.g. Festival advance" value={cashNote} onChangeText={setCashNote}/>
                  <TouchableOpacity style={[det.actionBtn,{marginTop:10}]} onPress={addCashEntry}>
                    <Text style={det.actionBtnTxt}>+ Add Entry</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={det.card}>
                <Text style={det.cardTitle}>💰 Salary Summary</Text>
                <Text style={det.cardHint}>{MONTH_NAMES[calMonth]} {calYear}</Text>
                <View style={det.summaryBlock}>
                  <View style={det.sumRow}><Text style={det.sumLabel}>Monthly Salary</Text><Text style={det.sumVal}>{fmtMoney(emp.monthlySalary)}</Text></View>
                  <View style={det.sumRow}><Text style={det.sumLabel}>Earned ({effectiveDays}/{emp.workingDays} days)</Text><Text style={[det.sumVal,{color:'#27ae60',fontWeight:'700'}]}>{fmtMoney(earned)}</Text></View>
                  {adv>0&&<View style={det.sumRow}><Text style={det.sumLabel}>Advances Given</Text><Text style={[det.sumVal,{color:'#e67e22'}]}>− {fmtMoney(adv)}</Text></View>}
                  {ded>0&&<View style={det.sumRow}><Text style={det.sumLabel}>Deductions</Text><Text style={[det.sumVal,{color:'#e74c3c'}]}>− {fmtMoney(ded)}</Text></View>}
                  {paid>0&&<View style={det.sumRow}><Text style={det.sumLabel}>Salary Paid</Text><Text style={[det.sumVal,{color:'#27ae60'}]}>− {fmtMoney(paid)}</Text></View>}
                  <View style={[det.sumRow,det.sumTotalRow]}>
                    <Text style={det.sumTotalLabel}>Balance to Pay</Text>
                    <Text style={[det.sumTotalVal,{color:bal>=0?'#2980b9':'#e74c3c'}]}>{fmtMoney(bal)}</Text>
                  </View>
                </View>
                {bal>0?(
                  <View style={det.pendingBanner}><Text style={det.pendingTxt}>⏳ {fmtMoney(bal)} pending salary to pay</Text></View>
                ):bal<0?(
                  <View style={[det.pendingBanner,{backgroundColor:'#fff2f2',borderColor:'#f0c0c0'}]}><Text style={[det.pendingTxt,{color:'#c0392b'}]}>⚠️ Overpaid by {fmtMoney(Math.abs(bal))}</Text></View>
                ):(
                  <View style={[det.pendingBanner,{backgroundColor:'#f2fff5',borderColor:'#b7e4c7'}]}><Text style={[det.pendingTxt,{color:'#1e8449'}]}>✓ Fully Settled — No balance due</Text></View>
                )}
              </View>

              <TouchableOpacity style={det.deleteBtn} onPress={confirmDelete}>
                <Text style={det.deleteBtnTxt}>🗑 Delete Employee</Text>
              </TouchableOpacity>
              <View style={{height:40}}/>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function EmployeesScreen(){
  const today=new Date();
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [loading,setLoading]=useState(true);
  const [year,setYear]=useState(today.getFullYear());
  const [month,setMonth]=useState(today.getMonth());
  const [selectedEmp,setSelectedEmp]=useState<Employee|null>(null);
  const [showAdd,setShowAdd]=useState(false);

  const loadEmployees=useCallback(async()=>{
    try{
      const data=await employeesApi.getAll();
      setEmployees(data.map(normalizeEmployee));
    }catch(e:any){Alert.alert('Error','Could not load employees: '+e.message);}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{loadEmployees();},[loadEmployees]);

  function updateEmployee(updated:Employee){
    setEmployees(es=>es.map(e=>e.id===updated.id?updated:e));
    if(selectedEmp?.id===updated.id) setSelectedEmp(updated);
  }

  function deleteEmployee(id:string){
    setEmployees(es=>es.filter(e=>e.id!==id));
  }

  function prevMonth(){if(month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1);}
  function nextMonth(){if(month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1);}

  const totalPayroll=employees.reduce((s,e)=>s+earnedSalary(e,year,month),0);
  const totalAdv=employees.reduce((s,e)=>s+sumByType(e,year,month,'advance')+sumByType(e,year,month,'deduction'),0);
  const totalPaid=employees.reduce((s,e)=>s+sumByType(e,year,month,'salary'),0);
  const totalBal=employees.reduce((s,e)=>s+balanceDue(e,year,month),0);

  if(loading){
    return(
      <SafeAreaView style={[main.container,{alignItems:'center',justifyContent:'center'}]}>
        <Text style={{color:'#888',fontSize:15}}>Loading employees…</Text>
      </SafeAreaView>
    );
  }

  return(
    <View style={main.container}>
      <View style={main.topBar}>
        <Text style={main.topTitle}>Employees</Text>
        <TouchableOpacity style={main.addBtn} onPress={()=>setShowAdd(true)}>
          <Text style={main.addBtnTxt}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={main.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={main.navBtn}><Text style={main.navTxt}>{'<'}</Text></TouchableOpacity>
          <Text style={main.monthTitle}>{MONTH_NAMES[month]} {year}</Text>
          <TouchableOpacity onPress={nextMonth} style={main.navBtn}><Text style={main.navTxt}>{'>'}</Text></TouchableOpacity>
        </View>

        <View style={main.summaryCard}>
          <Text style={main.summaryHeading}>{employees.length} Employee{employees.length!==1?'s':''}  ·  Monthly Overview</Text>
          <View style={main.summaryRow}>
            <View style={main.sumItem}><Text style={main.sumLabel}>Total Payroll</Text><Text style={[main.sumVal,{color:'#1A1A2E'}]}>{fmtMoney(totalPayroll)}</Text></View>
            <View style={main.sumItem}><Text style={main.sumLabel}>Advances</Text><Text style={[main.sumVal,{color:'#e67e22'}]}>{fmtMoney(totalAdv)}</Text></View>
            <View style={main.sumItem}><Text style={main.sumLabel}>Paid</Text><Text style={[main.sumVal,{color:'#27ae60'}]}>{fmtMoney(totalPaid)}</Text></View>
            <View style={main.sumItem}><Text style={main.sumLabel}>Balance</Text><Text style={[main.sumVal,{color:totalBal>=0?'#2980b9':'#e74c3c'}]}>{fmtMoney(totalBal)}</Text></View>
          </View>
        </View>

        {employees.length===0?(
          <View style={main.empty}>
            <Text style={main.emptyTxt}>No employees added yet.</Text>
            <Text style={main.emptyHint}>Tap "+ Add" to add your first employee.</Text>
          </View>
        ):(
          employees.map(emp=>(
            <EmployeeCard key={emp.id} emp={emp} year={year} month={month} onPress={()=>setSelectedEmp(emp)}/>
          ))
        )}
        <View style={{height:40}}/>
      </ScrollView>

      {showAdd&&<AddEmployeeModal onClose={()=>setShowAdd(false)} onAdd={e=>setEmployees(es=>[...es,e])}/>}
      {selectedEmp&&(
        <EmployeeDetailModal
          employee={selectedEmp} year={year} month={month}
          onClose={()=>setSelectedEmp(null)} onUpdate={updateEmployee} onDelete={deleteEmployee}
        />
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const main=StyleSheet.create({
  container:      {flex:1,backgroundColor:'#EEF0FF'},
  topBar:         {flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18,paddingTop:52,paddingBottom:14,backgroundColor:'#FFFFFF',borderBottomWidth:1,borderBottomColor:'rgba(123,97,255,0.12)'},
  topTitle:       {fontSize:22,fontWeight:'800',color:'#1A1A2E',letterSpacing:-0.3},
  addBtn:         {backgroundColor:'#7B61FF',paddingHorizontal:18,paddingVertical:9,borderRadius:22},
  addBtnTxt:      {color:'#fff',fontWeight:'700',fontSize:14,letterSpacing:0.1},
  monthNav:       {flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18,paddingVertical:14},
  navBtn:         {width:38,height:38,borderRadius:19,backgroundColor:'rgba(123,97,255,0.1)',alignItems:'center',justifyContent:'center'},
  navTxt:         {fontSize:16,fontWeight:'700',color:'#1A1A2E'},
  monthTitle:     {fontSize:17,fontWeight:'700',color:'#1A1A2E',letterSpacing:-0.2},
  summaryCard:    {marginHorizontal:16,marginBottom:14,backgroundColor:'#FFFFFF',borderRadius:18,padding:18,shadowColor:'#7B61FF',shadowOffset:{width:0,height:2},shadowOpacity:0.1,shadowRadius:10,elevation:3},
  summaryHeading: {fontSize:11,fontWeight:'700',color:'#6E6E8D',marginBottom:12,textTransform:'uppercase',letterSpacing:0.8},
  summaryRow:     {flexDirection:'row'},
  sumItem:        {flex:1,alignItems:'center'},
  sumLabel:       {fontSize:11,color:'#6E6E8D',marginBottom:3,fontWeight:'500'},
  sumVal:         {fontSize:16,fontWeight:'800'},
  empty:          {alignItems:'center',marginTop:72},
  emptyTxt:       {fontSize:17,fontWeight:'700',color:'#6E6E8D'},
  emptyHint:      {fontSize:13,color:'#9B98C0',marginTop:8,fontWeight:'500'},
});

const ec=StyleSheet.create({
  card:        {marginHorizontal:16,marginBottom:12,backgroundColor:'#FFFFFF',borderRadius:18,padding:18,shadowColor:'#7B61FF',shadowOffset:{width:0,height:2},shadowOpacity:0.1,shadowRadius:10,elevation:3},
  topRow:      {flexDirection:'row',alignItems:'flex-start',marginBottom:12},
  name:        {fontSize:17,fontWeight:'800',color:'#1A1A2E',letterSpacing:-0.2},
  role:        {fontSize:13,color:'#6E6E8D',marginTop:3,fontWeight:'500'},
  phone:       {fontSize:12,color:'#9B98C0',marginTop:2},
  salaryBadge: {alignItems:'flex-end'},
  salaryAmt:   {fontSize:17,fontWeight:'800',color:'#7B61FF'},
  salaryLabel: {fontSize:11,color:'#9B98C0',fontWeight:'500'},
  attRow:      {flexDirection:'row',gap:8,marginBottom:12},
  attChip:     {flex:1,alignItems:'center',paddingVertical:8,borderRadius:12},
  attNum:      {fontSize:17,fontWeight:'800'},
  attLbl:      {fontSize:10,fontWeight:'600',marginTop:2,letterSpacing:0.2},
  finRow:      {flexDirection:'row',borderTopWidth:1,borderTopColor:'rgba(123,97,255,0.1)',paddingTop:12},
  finItem:     {flex:1,alignItems:'center'},
  finLabel:    {fontSize:11,color:'#6E6E8D',fontWeight:'500'},
  finVal:      {fontSize:15,fontWeight:'800',marginTop:3},
});

const att=StyleSheet.create({
  container:  {marginTop:8},
  header:     {flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8},
  navBtn:     {width:30,height:30,borderRadius:15,backgroundColor:'rgba(123,97,255,0.1)',alignItems:'center',justifyContent:'center'},
  navTxt:     {fontSize:14,fontWeight:'700',color:'#1A1A2E'},
  title:      {fontSize:14,fontWeight:'700',color:'#1A1A2E'},
  dayRow:     {flexDirection:'row',marginBottom:4},
  dayName:    {flex:1,textAlign:'center',fontSize:11,fontWeight:'700',color:'#9B98C0'},
  weekRow:    {flexDirection:'row',marginBottom:2},
  cell:       {flex:1,aspectRatio:1,alignItems:'center',justifyContent:'center',borderRadius:6,borderWidth:1,borderColor:'transparent',margin:1},
  todayCell:  {borderColor:'#7B61FF',borderWidth:1.5},
  dayNum:     {fontSize:12,fontWeight:'600',color:'#1A1A2E'},
  todayNum:   {color:'#7B61FF',fontWeight:'800'},
  statusLbl:  {fontSize:9,fontWeight:'700',marginTop:1},
  legend:     {flexDirection:'row',justifyContent:'center',gap:12,marginTop:10,flexWrap:'wrap'},
  legendItem: {flexDirection:'row',alignItems:'center',gap:4},
  legendDot:  {width:8,height:8,borderRadius:4},
  legendTxt:  {fontSize:11,color:'#6E6E8D'},
});

const sh=StyleSheet.create({
  overlay:   {flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.55)'},
  sheet:     {backgroundColor:'#FFFFFF',borderTopLeftRadius:28,borderTopRightRadius:28,paddingHorizontal:20,paddingBottom:Platform.OS==='ios'?36:20},
  handle:    {width:44,height:4,backgroundColor:'rgba(123,97,255,0.15)',borderRadius:2,alignSelf:'center',marginTop:14,marginBottom:10},
  header:    {flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:18},
  title:     {fontSize:20,fontWeight:'800',color:'#1A1A2E',letterSpacing:-0.3},
  close:     {fontSize:18,color:'#9B98C0',padding:4},
  label:     {fontSize:11,fontWeight:'700',color:'#6E6E8D',marginTop:16,marginBottom:7,textTransform:'uppercase',letterSpacing:0.8},
  input:     {backgroundColor:'#F7F5FF',borderRadius:14,borderWidth:1,borderColor:'rgba(123,97,255,0.15)',paddingHorizontal:16,paddingVertical:13,fontSize:14,color:'#1A1A2E'},
  actionRow: {flexDirection:'row',gap:12,marginTop:22},
  cancelBtn: {flex:1,paddingVertical:15,borderRadius:14,borderWidth:1.5,borderColor:'rgba(123,97,255,0.2)',alignItems:'center'},
  cancelTxt: {fontSize:15,fontWeight:'700',color:'#9B98C0'},
  saveBtn:   {flex:2,paddingVertical:15,borderRadius:14,backgroundColor:'#7B61FF',alignItems:'center'},
  saveTxt:   {fontSize:15,fontWeight:'700',color:'#fff'},
});

const det=StyleSheet.create({
  overlay:        {flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.55)'},
  sheet:          {backgroundColor:'#EEF0FF',borderTopLeftRadius:28,borderTopRightRadius:28,paddingBottom:Platform.OS==='ios'?36:16},
  handle:         {width:44,height:4,backgroundColor:'rgba(123,97,255,0.15)',borderRadius:2,alignSelf:'center',marginTop:14,marginBottom:4},
  titleRow:       {flexDirection:'row',alignItems:'flex-start',paddingHorizontal:18,paddingTop:8,paddingBottom:10},
  title:          {fontSize:21,fontWeight:'800',color:'#1A1A2E',letterSpacing:-0.3},
  subtitle:       {fontSize:13,color:'#6E6E8D',marginTop:3,fontWeight:'500'},
  period:         {fontSize:11,color:'#9B98C0',marginTop:2,fontWeight:'500'},
  editBtn:        {backgroundColor:'rgba(123,97,255,0.1)',borderRadius:22,paddingHorizontal:16,paddingVertical:8,marginTop:4},
  editBtnTxt:     {fontSize:13,fontWeight:'700',color:'#7B61FF'},
  chipRow:        {flexDirection:'row',gap:8,paddingHorizontal:16,marginBottom:10},
  chip:           {flex:1,backgroundColor:'#FFFFFF',borderRadius:14,padding:12,alignItems:'center',borderWidth:1,borderColor:'rgba(123,97,255,0.12)',shadowColor:'#7B61FF',shadowOffset:{width:0,height:1},shadowOpacity:0.08,shadowRadius:4,elevation:1},
  chipLabel:      {fontSize:10,color:'#6E6E8D',marginBottom:3,fontWeight:'600',letterSpacing:0.2},
  chipVal:        {fontSize:14,fontWeight:'800',color:'#1A1A2E'},
  card:           {marginHorizontal:16,marginBottom:12,backgroundColor:'#FFFFFF',borderRadius:18,padding:18,shadowColor:'#7B61FF',shadowOffset:{width:0,height:2},shadowOpacity:0.08,shadowRadius:8,elevation:2},
  cardTitle:      {fontSize:15,fontWeight:'800',color:'#1A1A2E',marginBottom:3,letterSpacing:-0.2},
  cardHint:       {fontSize:11,color:'#6E6E8D',marginBottom:10,fontWeight:'500'},
  attCountRow:    {flexDirection:'row',gap:8,marginTop:14},
  attCountChip:   {flex:1,alignItems:'center',paddingVertical:10,borderRadius:14,borderWidth:1},
  attCountNum:    {fontSize:19,fontWeight:'800'},
  attCountLabel:  {fontSize:9,fontWeight:'700',marginTop:2,letterSpacing:0.3},
  earnedBox:      {backgroundColor:'#F7F5FF',borderRadius:14,padding:14,borderWidth:1,borderColor:'rgba(123,97,255,0.12)',marginTop:14},
  earnedRow:      {flexDirection:'row',justifyContent:'space-between',paddingVertical:5},
  earnedLabel:    {fontSize:13,color:'#6E6E8D',fontWeight:'500'},
  earnedVal:      {fontSize:13,fontWeight:'600',color:'#1A1A2E'},
  emptyHint:      {fontSize:13,color:'#9B98C0',fontStyle:'italic',paddingVertical:10},
  cashItem:       {flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'rgba(123,97,255,0.08)'},
  cashDot:        {width:9,height:9,borderRadius:5,flexShrink:0},
  cashNote:       {fontSize:13,fontWeight:'600',color:'#1A1A2E'},
  cashMeta:       {fontSize:11,color:'#9B98C0',marginTop:2,fontWeight:'500'},
  cashAmt:        {fontSize:15,fontWeight:'800'},
  delBtn:         {padding:4},
  delTxt:         {fontSize:12,color:'#EF4444'},
  inputLabel:     {fontSize:11,fontWeight:'700',color:'#6E6E8D',marginTop:14,marginBottom:7,textTransform:'uppercase',letterSpacing:0.8},
  typeRow:        {flexDirection:'row',gap:8,marginBottom:6,flexWrap:'wrap'},
  typeChip:       {paddingHorizontal:14,paddingVertical:9,borderRadius:22,borderWidth:1.5,borderColor:'rgba(123,97,255,0.2)',backgroundColor:'#F7F5FF'},
  typeChipActive: {backgroundColor:'#7B61FF',borderColor:'#7B61FF'},
  typeChipTxt:    {fontSize:13,fontWeight:'600',color:'#6E6E8D'},
  input:          {backgroundColor:'#F7F5FF',borderRadius:14,borderWidth:1,borderColor:'rgba(123,97,255,0.15)',paddingHorizontal:16,paddingVertical:13,fontSize:14,color:'#1A1A2E'},
  actionBtn:      {backgroundColor:'#7B61FF',borderRadius:16,paddingVertical:15,alignItems:'center'},
  actionBtnTxt:   {fontSize:15,fontWeight:'700',color:'#fff'},
  summaryBlock:   {backgroundColor:'#F7F5FF',borderRadius:14,padding:14,borderWidth:1,borderColor:'rgba(123,97,255,0.12)'},
  sumRow:         {flexDirection:'row',justifyContent:'space-between',paddingVertical:7,borderBottomWidth:1,borderBottomColor:'rgba(123,97,255,0.08)'},
  sumLabel:       {fontSize:13,color:'#6E6E8D',flex:1,fontWeight:'500'},
  sumVal:         {fontSize:13,fontWeight:'600',color:'#1A1A2E'},
  sumTotalRow:    {borderBottomWidth:0,borderTopWidth:2,borderTopColor:'rgba(123,97,255,0.15)',marginTop:4,paddingTop:12},
  sumTotalLabel:  {fontSize:14,fontWeight:'800',color:'#1A1A2E',flex:1},
  sumTotalVal:    {fontSize:17,fontWeight:'800'},
  pendingBanner:  {marginTop:14,backgroundColor:'#FFF8EC',borderRadius:12,paddingHorizontal:16,paddingVertical:12,borderWidth:1,borderColor:'#FCD34D'},
  pendingTxt:     {fontSize:13,fontWeight:'700',color:'#D97706',textAlign:'center'},
  deleteBtn:      {marginHorizontal:16,marginTop:10,marginBottom:4,paddingVertical:15,borderRadius:16,borderWidth:1.5,borderColor:'#EF4444',alignItems:'center'},
  deleteBtnTxt:   {fontSize:14,fontWeight:'700',color:'#EF4444'},
});
