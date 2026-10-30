import { expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { brainActivityProjection } from './brain-activity-projection';
import { readBrainEvents } from './brain-read-events';
const event = (type: string, payload: unknown) => ({id:'event',type,timestamp:'2026-10-25T00:00:00Z',payload});
it('projects canonical tool calls with attribution and excludes prompts and provider duplicates', () => {
 const call=event('tool.call',{id:'call',name:'read_repo_file',input:{path:'README.md'},turnId:'turn'});
 expect(brainActivityProjection(call)).toEqual(call);
 expect(brainActivityProjection(event('runtime.event',{systemPrompt:'private'}))).toBeUndefined();
 expect(brainActivityProjection(event('tool.call',{id:'provider-copy',name:'mcp__nm__read_repo_file',input:{path:'README.md'}}))).toBeUndefined();
 expect(brainActivityProjection(event('tool.call',{id:'codex-copy',tool:'read_repo_file',arguments:{path:'README.md'}}))).toBeUndefined();
});
it('keeps attributed public progress without exposing provider internals or copying final database messages', () => {
 const publicText=event('assistant.message',{text:'I’ll check the project documents.',turnId:'turn',provider:'agy',systemPrompt:'private'});
 expect(brainActivityProjection(publicText)).toEqual(event('assistant.message',{text:'I’ll check the project documents.',turnId:'turn'}));
 expect(brainActivityProjection(event('assistant.message',{text:'Copied final answer',actorId:'rex',turnId:'turn'}))).toBeUndefined();
 expect(brainActivityProjection(event('assistant.message',{text:'Unscoped text'}))).toBeUndefined();
 expect(brainActivityProjection(event('reasoning',{text:'private',turnId:'turn'}))).toBeUndefined();
 expect(brainActivityProjection(event('model.input',{system:'private',turnId:'turn'}))).toBeUndefined();
});
it('decodes compressed receipts, bounds display output, and never changes the archived event', () => {
 const payload={id:'call',name:'read_repo_file',output:'x'.repeat(20000),ok:true,turnId:'turn',systemPrompt:'omit'};
 const record=event('tool.result',{brainEncoding:'neuramesh.gzip.v1',data:gzipSync(JSON.stringify(payload)).toString('base64')});
 const before=JSON.stringify(record);
 const result=brainActivityProjection(record) as {payload:typeof payload};
 expect(result.payload.output).toHaveLength(16000+'\n… Output shortened for display.'.length);
 expect(result.payload.turnId).toBe('turn');expect(result.payload.systemPrompt).toBeUndefined();
 expect(JSON.stringify(record)).toBe(before);
});
it('omits irrelevant events without weakening segment verification',async()=>{
 const entries=[event('runtime.event',{prompt:'hidden'}),event('turn.open',{turnId:'turn',agentId:'agent',kind:'chat'})];
 const bytes=Buffer.from(entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
 const ref={backend:'file' as const,key:'segment',sizeBytes:bytes.length,sha256:'',mime:'application/x-ndjson'};
 expect(await readBrainEvents({get:async()=>bytes},[{segment:ref,event_count:2}],brainActivityProjection)).toEqual([entries[1]]);
 await expect(readBrainEvents({get:async()=>bytes},[{segment:ref,event_count:3}],brainActivityProjection)).rejects.toThrow('event count');
});
