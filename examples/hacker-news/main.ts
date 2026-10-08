import { mount } from '@memoized-dom/runtime';
import { HackerNewsApp } from './HackerNewsApp';
import './styles.css';

let render = mount('root', HackerNewsApp);

console.log(render)
