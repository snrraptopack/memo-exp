import * as _MD from "@memoized-dom/runtime";
const _WRITES_ = ["./bench/dom/AppInline.tsx#data", "./bench/dom/AppInline.tsx#selected", "./bench/dom/data.ts#nextId"];
const _WRITES_2 = ["./bench/dom/AppInline.tsx#data", "./bench/dom/data.ts#nextId"];
const _WRITES_3 = ["./bench/dom/AppInline.tsx#data"];
const _WRITES_4 = ["./bench/dom/AppInline.tsx#data", "./bench/dom/AppInline.tsx#selected"];
const _WRITES_5 = ["./bench/dom/AppInline.tsx#selected"];
let _liTemplate;
_MD.installAccessTable({
  readers: {
    "./bench/dom/AppInline.tsx#data": ["BenchAppInline", "BenchAppInline/*"],
    "./bench/dom/AppInline.tsx#selected": ["BenchAppInline/data/Row[*]", "BenchAppInline/data/Row[*]/*"],
    "./bench/dom/data.ts#adjectives": ["BenchAppInline", "BenchAppInline/*"],
    "./bench/dom/data.ts#colours": ["BenchAppInline", "BenchAppInline/*"],
    "./bench/dom/data.ts#nextId": ["BenchAppInline", "BenchAppInline/*"],
    "./bench/dom/data.ts#nouns": ["BenchAppInline", "BenchAppInline/*"]
  }
}, "BenchAppInline", "./bench/dom/AppInline.tsx");
/**
 * @file AppInline.tsx
 * The TSX source code for the Inline Row Benchmark App.
 */
import { buildData } from './data';
let data = [];
let selected = null;
export function BenchAppInline(_id, _parent) {
  let _value;
  const _update = () => {
    _region.reconcile(data);
  };
  _MD.register({
    id: _id,
    parent: _parent,
    render: _update
  });
  const _text = document.createTextNode("create1k");
  const _button = document.createElement("button");
  _button.onclick = () => {
    data = buildData(1000);
    selected = null;
    _MD.commitWrites(_WRITES_);
  };
  _button.appendChild(_text);
  const _text2 = document.createTextNode("create10k");
  const _button2 = document.createElement("button");
  _button2.onclick = () => {
    data = buildData(10000);
    selected = null;
    _MD.commitWrites(_WRITES_);
  };
  _button2.appendChild(_text2);
  const _text3 = document.createTextNode("append1k");
  const _button3 = document.createElement("button");
  _button3.onclick = () => {
    data = data.concat(buildData(1000));
    _MD.commitWrites(_WRITES_2);
  };
  _button3.appendChild(_text3);
  const _text4 = document.createTextNode("update");
  const _button4 = document.createElement("button");
  _button4.onclick = () => {
    for (let i = 0; i < data.length; i += 10) data[i]!.label += ' !!!';
    _MD.commitWrites(_WRITES_3);
  };
  _button4.appendChild(_text4);
  const _text5 = document.createTextNode("swap");
  const _button5 = document.createElement("button");
  _button5.onclick = () => {
    if (data.length > 998) {
      const t = data[1]!;
      data[1] = data[998]!;
      data[998] = t;
    }
    _MD.commitWrites(_WRITES_3);
  };
  _button5.appendChild(_text5);
  const _text6 = document.createTextNode("remove");
  const _button6 = document.createElement("button");
  _button6.onclick = () => {
    data.splice(500, 1);
    _MD.commitWrites(_WRITES_3);
  };
  _button6.appendChild(_text6);
  const _text7 = document.createTextNode("clear");
  const _button7 = document.createElement("button");
  _button7.onclick = () => {
    data = [];
    selected = null;
    _MD.commitWrites(_WRITES_4);
  };
  _button7.appendChild(_text7);
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
  const _onClickBinding = _MD.createDelegatedEventBinding(_ul, "onClick");
  const _region = _MD.createListRegion(_ul, _id + "/data", (item, _rowId) => {
    let _slot, _slot2, _slot3, _value2;
    const _update2 = () => {
      if (_slot !== (_value2 = item.id)) {
        _slot = _value2;
        _text8.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
      }
      if (_slot2 !== (_value2 = item.label)) {
        _slot2 = _value2;
        _text0.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
      }
      if (_slot3 !== (_value2 = _MD.classValue(selected === item.id ? 'danger' : ''))) {
        _slot3 = _value2;
        _MD.setClassValue(_li, _value2);
      }
    };
    _MD.register({
      id: _rowId,
      parent: _id,
      render: _update2
    });
    const _li = (_liTemplate === void 0 ? _liTemplate = (() => {
      const _text8 = document.createTextNode("");
      const _text9 = document.createTextNode(": ");
      const _text0 = document.createTextNode("");
      const _li = document.createElement("li");
      _li.appendChild(_text8);
      _li.appendChild(_text9);
      _li.appendChild(_text0);
      return _li;
    })() : _liTemplate).cloneNode(true);
    const _text8 = _li.firstChild;
    const _text0 = _li.firstChild.nextSibling.nextSibling;
    if (_slot !== (_value2 = item.id)) {
      _slot = _value2;
      _text8.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot2 !== (_value2 = item.label)) {
      _slot2 = _value2;
      _text0.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot3 !== (_value2 = _MD.classValue(selected === item.id ? 'danger' : ''))) {
      _slot3 = _value2;
      _MD.setClassValue(_li, _value2);
    }
    _MD.setDelegatedEvent(_onClickBinding, _li, () => {
      selected = item.id;
      _MD.commitWrites(_WRITES_5);
    });
    return {
      nodes: [_li],
      entities: [_rowId],
      updateProps: _nextItem => {
        item = _nextItem;
      },
      update: _update2
    };
  }, item => item.id);
  _region.reconcile(data);
  const _div2 = document.createElement("div");
  _div2.appendChild(_div);
  _div2.appendChild(_ul);
  return _div2;
}
_MD.registerRootFactory(BenchAppInline, {
  id: "BenchAppInline",
  create: () => BenchAppInline("BenchAppInline", null, [])
});

export function createCompiledInlineApp() {
  const root = BenchAppInline('BenchAppInline', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      if (!b) throw new Error(`Button '${name}' not found in compiled inline app`);
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
