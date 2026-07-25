import * as _MD from "../../src/runtime";
const _WRITES_ = ["./bench/dom/App.tsx#selected"];
const _WRITES_2 = ["./bench/dom/App.tsx#data", "./bench/dom/App.tsx#selected", "./bench/dom/data.ts#nextId"];
const _WRITES_3 = ["./bench/dom/App.tsx#data", "./bench/dom/data.ts#nextId"];
const _WRITES_4 = ["./bench/dom/App.tsx#data"];
const _WRITES_5 = ["./bench/dom/App.tsx#data", "./bench/dom/App.tsx#selected"];
_MD.installAccessTable({
  readers: {
    "./bench/dom/App.tsx#data": ["AppTsx", "AppTsx/*"],
    "./bench/dom/App.tsx#selected": ["AppTsx", "AppTsx/*"],
    "./bench/dom/data.ts#adjectives": ["AppTsx", "AppTsx/*"],
    "./bench/dom/data.ts#colours": ["AppTsx", "AppTsx/*"],
    "./bench/dom/data.ts#nextId": ["AppTsx", "AppTsx/*"],
    "./bench/dom/data.ts#nouns": ["AppTsx", "AppTsx/*"]
  }
}, "AppTsx");
/**
 * @file App.tsx
 * The TSX source code for the Component Row Benchmark App.
 */
import { buildData } from './data';
let data = [];
let selected = null;
function Row(props, _id) {
  let _slot, _slot2, _slot3, _value;
  const _update = () => {
    if (_slot !== (_value = props.item.id)) {
      _slot = _value;
      _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot2 !== (_value = props.item.label)) {
      _slot2 = _value;
      _text3.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot3 !== (_value = selected === props.item.id ? 'danger' : '')) {
      _slot3 = _value;
      _li.className = _value;
    }
  };
  const _text = document.createTextNode("");
  if (_slot !== (_value = props.item.id)) {
    _slot = _value;
    _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _text2 = document.createTextNode(": ");
  const _text3 = document.createTextNode("");
  if (_slot2 !== (_value = props.item.label)) {
    _slot2 = _value;
    _text3.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _li = document.createElement("li");
  if (_slot3 !== (_value = selected === props.item.id ? 'danger' : '')) {
    _slot3 = _value;
    _li.className = _value;
  }
  _li.onclick = () => {
    selected = props.item.id;
    _MD.commitWrites(_WRITES_);
  };
  _li.appendChild(_text);
  _li.appendChild(_text2);
  _li.appendChild(_text3);
  return {
    nodes: [_li],
    entities: [],
    update: _update,
    updateProps: _nextProp => {
      props = _nextProp;
    }
  };
}
export function BenchApp(_id2, _parent) {
  let _value2;
  const _update2 = () => {
    _region.reconcile(data);
  };
  _MD.register({
    id: _id2,
    parent: _parent,
    render: _update2
  });
  const _text4 = document.createTextNode("create1k");
  const _button = document.createElement("button");
  _button.onclick = () => {
    data = buildData(1000);
    selected = null;
    _MD.commitWrites(_WRITES_2);
  };
  _button.appendChild(_text4);
  const _text5 = document.createTextNode("create10k");
  const _button2 = document.createElement("button");
  _button2.onclick = () => {
    data = buildData(10000);
    selected = null;
    _MD.commitWrites(_WRITES_2);
  };
  _button2.appendChild(_text5);
  const _text6 = document.createTextNode("append1k");
  const _button3 = document.createElement("button");
  _button3.onclick = () => {
    data = data.concat(buildData(1000));
    _MD.commitWrites(_WRITES_3);
  };
  _button3.appendChild(_text6);
  const _text7 = document.createTextNode("update");
  const _button4 = document.createElement("button");
  _button4.onclick = () => {
    for (let i = 0; i < data.length; i += 10) data[i]!.label += ' !!!';
    _MD.commitWrites(_WRITES_4);
  };
  _button4.appendChild(_text7);
  const _text8 = document.createTextNode("swap");
  const _button5 = document.createElement("button");
  _button5.onclick = () => {
    if (data.length > 998) {
      const t = data[1]!;
      data[1] = data[998]!;
      data[998] = t;
    }
    _MD.commitWrites(_WRITES_4);
  };
  _button5.appendChild(_text8);
  const _text9 = document.createTextNode("remove");
  const _button6 = document.createElement("button");
  _button6.onclick = () => {
    data.splice(500, 1);
    _MD.commitWrites(_WRITES_4);
  };
  _button6.appendChild(_text9);
  const _text0 = document.createTextNode("clear");
  const _button7 = document.createElement("button");
  _button7.onclick = () => {
    data = [];
    selected = null;
    _MD.commitWrites(_WRITES_5);
  };
  _button7.appendChild(_text0);
  const _div = document.createElement("div");
  _div.className = "toolbar";
  _div.appendChild(_button);
  _div.appendChild(_button2);
  _div.appendChild(_button3);
  _div.appendChild(_button4);
  _div.appendChild(_button5);
  _div.appendChild(_button6);
  _div.appendChild(_button7);
  const _ul = document.createElement("ul");
  const _region = _MD.createListRegion(_ul, _id2 + "/data", (item, _rowId) => {
    const _entry = Row({
      item
    }, _rowId);
    return {
      nodes: _entry.nodes,
      entities: [],
      update: _entry.update,
      updateProps: item => {
        _entry.updateProps({
          item
        });
      }
    };
  }, item => item.id);
  _region.reconcile(data);
  const _div2 = document.createElement("div");
  _div2.appendChild(_div);
  _div2.appendChild(_ul);
  return _div2;
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
