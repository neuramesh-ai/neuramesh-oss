import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {financeAgySettings} from './model-runtime';
test('Finance removes all allowed MCP tools and denies native and external tools per session',async()=>{
 const home=await mkdtemp(join(tmpdir(),'finance-tool-fence-'));
 try{
  await mkdir(join(home,'.gemini/config'),{recursive:true});await writeFile(join(home,'.gemini/config/mcp_config.json'),JSON.stringify({mcpServers:{nm:{},other:{}}}));
  const settings=JSON.parse(financeAgySettings(home));assert.equal(settings.allowNonWorkspaceAccess,false);assert.deepEqual(settings.permissions.allow,[]);
  for(const denied of ['read_file(*)','write_file(*)','command(*)','unsandboxed(*)','read_url(*)','execute_url(*)','mcp(nm/*)','mcp(other/*)'])assert.ok(settings.permissions.deny.includes(denied),denied);
 }finally{await rm(home,{recursive:true,force:true});}
});
