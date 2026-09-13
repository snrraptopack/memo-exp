import {serve} from "...."

const server = serve({options}) now inside the options we will be able to inject stuff as well as the template or what we want to serve as a static from there

server.get and co can come and even we can do something like server.ssr where ssr can take the whole app which is every thing becomes an ssr or some specific