import * as _MD from "@memoized-dom/runtime";
const _WRITES_ = ["./bench/dom/App.tsx#selected"];
let _liTemplate;
const _WRITES_2 = ["./bench/dom/App.tsx#data", "./bench/dom/App.tsx#selected", "./bench/dom/data.ts#nextId"];
const _WRITES_3 = ["./bench/dom/App.tsx#data", "./bench/dom/data.ts#nextId"];
const _WRITES_4 = ["./bench/dom/App.tsx#data"];
const _WRITES_5 = ["./bench/dom/App.tsx#data", "./bench/dom/App.tsx#selected"];
_MD.installAccessTable({
  readers: {
    "./bench/dom/App.tsx#data": ["BenchApp", "BenchApp/*"],
    "./bench/dom/App.tsx#selected": ["BenchApp/data/Row[*]", "BenchApp/data/Row[*]/*"],
    "./bench/dom/data.ts#adjectives": ["BenchApp", "BenchApp/*"],
    "./bench/dom/data.ts#colours": ["BenchApp", "BenchApp/*"],
    "./bench/dom/data.ts#nextId": ["BenchApp", "BenchApp/*"],
    "./bench/dom/data.ts#nouns": ["BenchApp", "BenchApp/*"]
  }
}, "BenchApp", "./bench/dom/App.tsx");
/**
 * @file App.tsx
 * The TSX source code for the Component Row Benchmark App.
 */
import { buildData } from './data';
let data = [];
let selected = null;
function Row(props, _id, _onClickBinding) {
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
    if (_slot3 !== (_value = _MD.classValue(selected === props.item.id ? 'danger' : ''))) {
      _slot3 = _value;
      _MD.setClassValue(_li, _value);
    }
  };
  const _li = (_liTemplate === void 0 ? _liTemplate = (() => {
    const _text = document.createTextNode("");
    const _text2 = document.createTextNode(": ");
    const _text3 = document.createTextNode("");
    const _li = document.createElement("li");
    _li.appendChild(_text);
    _li.appendChild(_text2);
    _li.appendChild(_text3);
    return _li;
  })() : _liTemplate).cloneNode(true);
  const _text = _li.firstChild;
  const _text3 = _li.firstChild.nextSibling.nextSibling;
  if (_slot !== (_value = props.item.id)) {
    _slot = _value;
    _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  if (_slot2 !== (_value = props.item.label)) {
    _slot2 = _value;
    _text3.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  if (_slot3 !== (_value = _MD.classValue(selected === props.item.id ? 'danger' : ''))) {
    _slot3 = _value;
    _MD.setClassValue(_li, _value);
  }
  _MD.setDelegatedEvent(_onClickBinding, _li, () => {
    selected = props.item.id;
    _MD.commitWrites(_WRITES_);
  });
  return {
    nodes: _li,
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
  _MD.setClassValue(_div, "toolbar");
  _div.appendChild(_button);
  _div.appendChild(_button2);
  _div.appendChild(_button3);
  _div.appendChild(_button4);
  _div.appendChild(_button5);
  _div.appendChild(_button6);
  _div.appendChild(_button7);
  const _ul = document.createElement("ul");
  const _onClickBinding2 = _MD.createDelegatedEventBinding(_ul, "onClick");
  const _region = _MD.createListRegion(_ul, _id2 + "/data", (item, _rowId) => {
    const _entry = Row({
      item
    }, _rowId, _onClickBinding2);
    const _pushRowProps = _entry.updateProps;
    _entry.updateProps = _nextItem => {
      item = _nextItem;
      _pushRowProps({
        item
      });
    };
    return _entry;
  }, item => item.id, false);
  _region.reconcile(data);
  const _div2 = document.createElement("div");
  _div2.appendChild(_div);
  _div2.appendChild(_ul);
  return _div2;
}
_MD.registerRootFactory(BenchApp, {
  id: "BenchApp",
  create: () => BenchApp("BenchApp", null, [])
});

export function createCompiledTsxApp() {
  const root = BenchApp('BenchApp', null) as HTMLElement;
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
