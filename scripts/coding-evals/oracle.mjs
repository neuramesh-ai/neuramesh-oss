// Independent acceptance checks live outside the agent's editable fixture.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [id,dir]=process.argv.slice(2);
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const load=(file)=>import(pathToFileURL(resolve(dir,file)).href);
if(id==='simple') {
  const {formatDuration:f}=await load('src/duration.mjs');
  check('boundaries and unbounded hours',()=>{for(const [n,s] of [[0,'0:00:00'],[9,'0:00:09'],[60,'0:01:00'],[3599,'0:59:59'],[3600,'1:00:00'],[360005,'100:00:05']]) assert.equal(f(n),s);});
  check('reject invalid numeric values',()=>{for(const n of [-1,.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>f(n),RangeError);});
  check('no implicit coercion',()=>{for(const n of ['5',null,undefined,{},true]) assert.throws(()=>f(n),TypeError);});
} else if(id==='medium') {
  const {addTask:add,toggleTask:toggle,visibleTasks:filter}=await load('src/tasks.mjs');
  const original=Object.freeze([Object.freeze({id:'a',title:'First',completed:false})]);
  let tasks;
  check('trim, append and preserve input',()=>{tasks=add(original,' Second ','b');assert.deepEqual(tasks,[...original,{id:'b',title:'Second',completed:false}]);assert.equal(original.length,1);});
  check('invalid title and duplicate ID rejected',()=>{assert.throws(()=>add(tasks,'  ','c'));assert.throws(()=>add(tasks,'Duplicate','a'));});
  check('toggle targets one task without mutation',()=>{const next=toggle(tasks,'b');assert.equal(next[1].completed,true);assert.equal(tasks[1].completed,false);assert.deepEqual(toggle(tasks,'missing'),tasks);tasks=next;});
  check('all three filters preserve order',()=>{assert.deepEqual(filter(tasks,'all'),tasks);assert.deepEqual(filter(tasks,'active'),[tasks[0]]);assert.deepEqual(filter(tasks,'completed'),[tasks[1]]);});
} else if(id==='complex') {
  const {migrate,addExpense:add,visibleExpenses:filter,totals,importExpenses:merge}=await load('src/ledger.mjs');
  const old={version:1,items:[{id:'old',title:' Train ',amount:12.34,category:'Travel'}]};
  let state;
  check('versioned migration preserves cents',()=>{state=migrate(old);assert.deepEqual(state,{version:2,expenses:[{id:'old',title:'Train',amountCents:1234,category:'Travel'}]});assert.equal(old.items[0].title,' Train ');assert.deepEqual(migrate(null),{version:2,expenses:[]});});
  check('immutable add and exact totals',()=>{const prior=structuredClone(state);const next=add(state,{id:'meal',title:'Lunch',amountCents:105,category:'Food'});assert.deepEqual(state,prior);state=next;assert.deepEqual(totals(state),{totalCents:1339,byCategory:{Travel:1234,Food:105}});assert.deepEqual(filter(state,'Food'),[state.expenses[1]]);assert.deepEqual(filter(state,'all'),state.expenses);});
  check('invalid and duplicate entries rejected',()=>{for(const amountCents of [0,-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>add(state,{id:'x',title:'Bad',amountCents,category:'Food'}));assert.throws(()=>add(state,state.expenses[0]));assert.throws(()=>add(state,{id:'x',title:' ',amountCents:1,category:'Food'}));assert.throws(()=>migrate({version:9,expenses:[]}));});
  check('handoff implements atomic import',()=>{const before=structuredClone(state);const extra={id:'new',title:'Book',amountCents:500,category:'Study'};assert.equal(merge(state,JSON.stringify([extra])).expenses.length,3);assert.throws(()=>merge(state,JSON.stringify([extra,extra])));assert.throws(()=>merge(state,JSON.stringify([extra,state.expenses[0]])));assert.throws(()=>merge(state,'not json'));assert.deepEqual(state,before);});
  check('totals reject unsafe arithmetic',()=>assert.throws(()=>totals({version:2,expenses:[{id:'a',title:'Big',category:'x',amountCents:Number.MAX_SAFE_INTEGER},{id:'b',title:'More',category:'x',amountCents:1}]})));
} else throw new Error('Unknown oracle case');
console.log(JSON.stringify({passed:true,checks}));
