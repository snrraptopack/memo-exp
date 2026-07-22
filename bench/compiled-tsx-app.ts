import * as MD from "../src/runtime";
const WRITES_0 = ["selected"];
const WRITES_1 = ["data", "selected"];
const WRITES_2 = ["data", "selected"];
const WRITES_3 = ["data", "selected"];
MD.installAccessTable({
  readers: {
    "data": ["AppTsx", "AppTsx/*"],
    "selected": ["AppTsx", "AppTsx/*"]
  }
}, "AppTsx");
/**
 * @file App.tsx
 * The TSX source code for the Component Row Benchmark App.
 */

import { buildData } from './data';
let data = [];
let selected = null;
function Row(props, __memoRowId) {
  let $s0, $s1, $s2, $t;
  const update = () => {
    if ($s0 !== ($t = props.item.id)) {
      $s0 = $t;
      text0.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s1 !== ($t = props.item.label)) {
      $s1 = $t;
      text2.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s2 !== ($t = selected === props.item.id ? 'danger' : '')) {
      $s2 = $t;
      li0.className = $t;
    }
  };
  const text0 = document.createTextNode("");
  if ($s0 !== ($t = props.item.id)) {
    $s0 = $t;
    text0.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const text1 = document.createTextNode(": ");
  const text2 = document.createTextNode("");
  if ($s1 !== ($t = props.item.label)) {
    $s1 = $t;
    text2.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const li0 = document.createElement("li");
  if ($s2 !== ($t = selected === props.item.id ? 'danger' : '')) {
    $s2 = $t;
    li0.className = $t;
  }
  li0.onclick = () => {
    selected = props.item.id;
    MD.commitWrites(WRITES_0);
  };
  li0.appendChild(text0);
  li0.appendChild(text1);
  li0.appendChild(text2);
  return {
    nodes: [li0],
    entities: [],
    update: update,
    updateProps: __memoNext0 => {
      props = __memoNext0;
    }
  };
}
export function BenchApp(id, parent) {
  let $t;
  const update = () => {
    region0.reconcile(data);
  };
  MD.register({
    id: id,
    parent: parent,
    render: update
  });
  const text0 = document.createTextNode("create1k");
  const button0 = document.createElement("button");
  button0.onclick = () => {
    data = buildData(1000);
    selected = null;
    MD.commitWrites(WRITES_1);
  };
  button0.appendChild(text0);
  const text1 = document.createTextNode("create10k");
  const button1 = document.createElement("button");
  button1.onclick = () => {
    data = buildData(10000);
    selected = null;
    MD.commitWrites(WRITES_2);
  };
  button1.appendChild(text1);
  const text2 = document.createTextNode("append1k");
  const button2 = document.createElement("button");
  button2.onclick = () => {
    data = data.concat(buildData(1000));
    MD.markDirty(id);
  };
  button2.appendChild(text2);
  const text3 = document.createTextNode("update");
  const button3 = document.createElement("button");
  button3.onclick = () => {
    for (let i = 0; i < data.length; i += 10) data[i]!.label += ' !!!';
    MD.markDirty(id);
  };
  button3.appendChild(text3);
  const text4 = document.createTextNode("swap");
  const button4 = document.createElement("button");
  button4.onclick = () => {
    if (data.length > 998) {
      const t = data[1]!;
      data[1] = data[998]!;
      data[998] = t;
    }
    MD.markDirty(id);
  };
  button4.appendChild(text4);
  const text5 = document.createTextNode("remove");
  const button5 = document.createElement("button");
  button5.onclick = () => {
    data.splice(500, 1);
    MD.markDirty(id);
  };
  button5.appendChild(text5);
  const text6 = document.createTextNode("clear");
  const button6 = document.createElement("button");
  button6.onclick = () => {
    data = [];
    selected = null;
    MD.commitWrites(WRITES_3);
  };
  button6.appendChild(text6);
  const div0 = document.createElement("div");
  div0.className = "toolbar";
  div0.appendChild(button0);
  div0.appendChild(button1);
  div0.appendChild(button2);
  div0.appendChild(button3);
  div0.appendChild(button4);
  div0.appendChild(button5);
  div0.appendChild(button6);
  const ul0 = document.createElement("ul");
  const region0 = MD.createListRegion(ul0, id + "/data", (item, rowId) => {
    const entry = Row({
      item
    }, rowId);
    return {
      nodes: entry.nodes,
      entities: [],
      update: entry.update,
      updateProps: item => {
        entry.updateProps({
          item
        });
      }
    };
  }, item => item.id);
  region0.reconcile(data);
  const div1 = document.createElement("div");
  div1.appendChild(div0);
  div1.appendChild(ul0);
  return div1;
}

export function createCompiledTsxApp() {
  const root = BenchApp('AppTsx', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      if (!b) throw new Error(`Button '${name}' not found in compiled app`);
      b.click();
    },
    selectRow(index: number) {
      (ul.children[index] as HTMLElement).click();
    },
    rowCount() {
      return ul.children.length;
    },
  };
}
