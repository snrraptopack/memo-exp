/**
 * Browser bootstrap outside the authored compiler graph.
 */
import { App } from './App';

type AppFactory = (id: string, parent: null) => HTMLElement;

document.body.append((App as unknown as AppFactory)('App', null));
