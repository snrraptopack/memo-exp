/** Generate example facade/registry types through their configured Vite adapter. */
import {resolve} from 'node:path';
import {createServer} from 'vite';

const server=await createServer({
  configFile:resolve(import.meta.dirname,'../examples/fullstack/vite.config.ts'),
  logLevel:'error',
  server:{middlewareMode:true,hmr:false,watch:null},
  optimizeDeps:{noDiscovery:true,include:[]},
});
try {
  await server.environments.client!.pluginContainer.buildStart();
} finally {
  await server.close();
}
