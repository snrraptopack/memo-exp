// @ts-nocheck
/**
 * Generated from examples/todo.tsx; rebuild with bun run examples/build-todo.ts.
 */
import * as _MD from "@memoized-dom/runtime";
const _WRITES_ = ["/examples/db.ts#completedSet", "/examples/db.ts#state.isLoading", "/examples/db.ts#state.statusMessage", "/examples/db.ts#todos"];
const _WRITES_2 = ["/examples/db.ts#categoryMap", "/examples/db.ts#todos"];
const _WRITES_3 = ["/examples/db.ts#completedSet", "/examples/db.ts#todos"];
const _WRITES_4 = ["/examples/db.ts#completedSet"];
const _WRITES_5 = ["/examples/todo.tsx#totalCount"];
const _WRITES_6 = ["/examples/todo.tsx#completedCount"];
const _WRITES_7 = ["/examples/todo.tsx#activeCount"];
_MD.installAccessTable({
  readers: {
    "/examples/db.ts#categoryMap": ["TodoApp", "TodoApp/*"],
    "/examples/db.ts#completedSet": ["TodoApp", "TodoApp/$computed/%2Fexamples%2Ftodo.tsx#completedCount", "TodoApp/*"],
    "/examples/db.ts#state": ["TodoApp", "TodoApp/*"],
    "/examples/db.ts#state.isLoading": ["TodoApp", "TodoApp/*"],
    "/examples/db.ts#state.statusMessage": ["TodoApp", "TodoApp/*"],
    "/examples/db.ts#todos": ["TodoApp", "TodoApp/$computed/%2Fexamples%2Ftodo.tsx#totalCount", "TodoApp/*"],
    "/examples/todo.tsx#activeCount": ["TodoApp", "TodoApp/*"],
    "/examples/todo.tsx#completedCount": ["TodoApp", "TodoApp/$computed/%2Fexamples%2Ftodo.tsx#activeCount", "TodoApp/*"],
    "/examples/todo.tsx#totalCount": ["TodoApp", "TodoApp/$computed/%2Fexamples%2Ftodo.tsx#activeCount", "TodoApp/*"]
  }
}, "TodoApp");
import { todos, completedSet, categoryMap, state } from './db';
import { fetchRemoteTodos } from './api';
import { TodoItem } from './TodoItem';
let totalCount = todos.length;
_MD.register({
  id: "TodoApp/$computed/%2Fexamples%2Ftodo.tsx#totalCount",
  parent: null,
  depth: -1,
  render: () => {
    const _totalCountNext = todos.length;
    if (_MD.computedChanged(totalCount, _totalCountNext)) {
      totalCount = _totalCountNext;
      _MD.commitWrites(_WRITES_5);
    }
  }
});
let completedCount = completedSet.size;
_MD.register({
  id: "TodoApp/$computed/%2Fexamples%2Ftodo.tsx#completedCount",
  parent: null,
  depth: -1,
  render: () => {
    const _completedCountNext = completedSet.size;
    if (_MD.computedChanged(completedCount, _completedCountNext)) {
      completedCount = _completedCountNext;
      _MD.commitWrites(_WRITES_6);
    }
  }
});
let activeCount = totalCount - completedCount;
_MD.register({
  id: "TodoApp/$computed/%2Fexamples%2Ftodo.tsx#activeCount",
  parent: null,
  depth: -1,
  render: () => {
    const _activeCountNext = totalCount - completedCount;
    if (_MD.computedChanged(activeCount, _activeCountNext)) {
      activeCount = _activeCountNext;
      _MD.commitWrites(_WRITES_7);
    }
  }
});
export function TodoApp(_id, _parent) {
  let _slot, _slot2, _slot3, _slot4, _slot5, _slot6, _value;
  const _update = () => {
    if (_slot !== (_value = state.statusMessage)) {
      _slot = _value;
      _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot2 !== (_value = totalCount)) {
      _slot2 = _value;
      _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot3 !== (_value = activeCount)) {
      _slot3 = _value;
      _text6.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot4 !== (_value = completedCount)) {
      _slot4 = _value;
      _text8.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot5 !== (_value = state.isLoading ? '⏳ Loading API...' : '🌐 Load Remote API Todos')) {
      _slot5 = _value;
      _text9.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot6 !== (_value = state.isLoading)) {
      _slot6 = _value;
      _MD.setDomValue(_button, "disabled", _value);
    }
    _region.reconcile(todos);
  };
  _MD.register({
    id: _id,
    parent: _parent,
    render: _update
  });
  const _text = document.createTextNode("⚡ Multi-Module Memoized DOM App");
  const _h = document.createElement("h1");
  _h.appendChild(_text);
  const _text2 = document.createTextNode("");
  if (_slot !== (_value = state.statusMessage)) {
    _slot = _value;
    _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _p = document.createElement("p");
  _MD.setClassValue(_p, "subtitle");
  _p.appendChild(_text2);
  const _text3 = document.createTextNode("Total: ");
  const _text4 = document.createTextNode("");
  if (_slot2 !== (_value = totalCount)) {
    _slot2 = _value;
    _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _strong = document.createElement("strong");
  _strong.appendChild(_text4);
  const _div = document.createElement("div");
  _MD.setClassValue(_div, "stat-pill");
  _div.appendChild(_text3);
  _div.appendChild(_strong);
  const _text5 = document.createTextNode("Active: ");
  const _text6 = document.createTextNode("");
  if (_slot3 !== (_value = activeCount)) {
    _slot3 = _value;
    _text6.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _strong2 = document.createElement("strong");
  _strong2.appendChild(_text6);
  const _div2 = document.createElement("div");
  _MD.setClassValue(_div2, "stat-pill");
  _div2.appendChild(_text5);
  _div2.appendChild(_strong2);
  const _text7 = document.createTextNode("Completed: ");
  const _text8 = document.createTextNode("");
  if (_slot4 !== (_value = completedCount)) {
    _slot4 = _value;
    _text8.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _strong3 = document.createElement("strong");
  _strong3.appendChild(_text8);
  const _div3 = document.createElement("div");
  _MD.setClassValue(_div3, "stat-pill");
  _div3.appendChild(_text7);
  _div3.appendChild(_strong3);
  const _div4 = document.createElement("div");
  _MD.setClassValue(_div4, "stats-bar");
  _div4.appendChild(_div);
  _div4.appendChild(_div2);
  _div4.appendChild(_div3);
  const _text9 = document.createTextNode("");
  if (_slot5 !== (_value = state.isLoading ? '⏳ Loading API...' : '🌐 Load Remote API Todos')) {
    _slot5 = _value;
    _text9.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _button = document.createElement("button");
  _button.onclick = () => {
    fetchRemoteTodos();
    _MD.commitWrites(_WRITES_);
  };
  if (_slot6 !== (_value = state.isLoading)) {
    _slot6 = _value;
    _MD.setDomValue(_button, "disabled", _value);
  }
  _button.appendChild(_text9);
  const _text0 = document.createTextNode("➕ Add Task");
  const _button2 = document.createElement("button");
  _button2.onclick = () => {
    const newId = Date.now();
    todos.push({
      id: newId,
      text: `New Task #${todos.length + 1}`
    });
    categoryMap.set(newId, 'General');
    _MD.commitWrites(_WRITES_2);
  };
  _button2.appendChild(_text0);
  const _text1 = document.createTextNode("🧹 Clear Completed");
  const _button3 = document.createElement("button");
  _button3.onclick = () => {
    const filtered = todos.filter(t => {
      const _returnValue = !completedSet.has(t.id);
      _MD.commitWrites(_WRITES_4);
      return _returnValue;
    });
    todos.length = 0;
    todos.push(...filtered);
    completedSet.clear();
    _MD.commitWrites(_WRITES_3);
  };
  _button3.appendChild(_text1);
  const _div5 = document.createElement("div");
  _MD.setClassValue(_div5, "actions");
  _div5.appendChild(_button);
  _div5.appendChild(_button2);
  _div5.appendChild(_button3);
  const _ul = document.createElement("ul");
  const _region = _MD.createListRegion(_ul, _id + "/todos", (item, _rowId) => {
    const _entry = TodoItem({
      item,
      completedSet,
      categoryMap
    }, _rowId);
    return {
      nodes: _entry.nodes,
      entities: [],
      update: _entry.update,
      updateProps: _nextItem => {
        item = _nextItem;
        _entry.updateProps({
          item,
          completedSet,
          categoryMap
        });
      }
    };
  }, item => item.id);
  _region.reconcile(todos);
  const _div6 = document.createElement("div");
  _MD.setClassValue(_div6, "todo-card");
  _div6.appendChild(_h);
  _div6.appendChild(_p);
  _div6.appendChild(_div4);
  _div6.appendChild(_div5);
  _div6.appendChild(_ul);
  return _div6;
}
