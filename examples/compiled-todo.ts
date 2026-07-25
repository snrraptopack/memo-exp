// @ts-nocheck
/**
 * Generated Compiled Output for examples/todo.tsx
 */
import * as _MD from "../src/runtime";
const _WRITES_ = ["./component.tsx#completedSet"];
const _WRITES_2 = ["./component.tsx#categoryMap"];
const _WRITES_3 = ["./component.tsx#categoryMap", "./component.tsx#todos"];
const _WRITES_4 = ["./component.tsx#completedSet", "./component.tsx#todos"];
const _WRITES_5 = ["./component.tsx#totalCount"];
const _WRITES_6 = ["./component.tsx#completedCount"];
const _WRITES_7 = ["./component.tsx#activeCount"];
_MD.installAccessTable({
  readers: {
    "./component.tsx#activeCount": ["TodoApp", "TodoApp/*"],
    "./component.tsx#categoryMap": ["TodoApp", "TodoApp/*"],
    "./component.tsx#completedCount": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#activeCount", "TodoApp/*"],
    "./component.tsx#completedSet": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#completedCount", "TodoApp/*"],
    "./component.tsx#todos": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#totalCount", "TodoApp/*"],
    "./component.tsx#totalCount": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#activeCount", "TodoApp/*"]
  }
}, "TodoApp");
// 1. Array Collection
let todos = [{
  id: 1,
  text: 'Master Memoized DOM Compiler'
}, {
  id: 2,
  text: 'Test JavaScript Set & Map Collections'
}, {
  id: 3,
  text: 'Verify Computed Derivations'
}];

// 2. Set Collection for Completed IDs (Const Collection)
const completedSet = new Set([1]);

// 3. Map Collection for Todo Categories (Const Collection)
const categoryMap = new Map([[1, 'Compiler'], [2, 'Reactivity'], [3, 'Performance']]);

// 4. Rule R13 Computed Derivations over Collections
let totalCount = todos.length;
_MD.register({
  id: "TodoApp/$computed/.%2Fcomponent.tsx#totalCount",
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
  id: "TodoApp/$computed/.%2Fcomponent.tsx#completedCount",
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
  id: "TodoApp/$computed/.%2Fcomponent.tsx#activeCount",
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
function TodoItem(props, _id) {
  let _slot, _slot2, _slot3, _slot4, _value;
  const _update = () => {
    if (_slot !== (_value = completedSet.has(props.item.id) ? '☑' : '☐')) {
      _slot = _value;
      _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot2 !== (_value = props.item.text)) {
      _slot2 = _value;
      _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot3 !== (_value = categoryMap.get(props.item.id) || 'General')) {
      _slot3 = _value;
      _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot4 !== (_value = completedSet.has(props.item.id) ? 'todo-item done' : 'todo-item')) {
      _slot4 = _value;
      _li.className = _value;
    }
  };
  const _text = document.createTextNode("");
  if (_slot !== (_value = completedSet.has(props.item.id) ? '☑' : '☐')) {
    _slot = _value;
    _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span = document.createElement("span");
  _span.className = "todo-check";
  _span.onclick = () => {
    if (completedSet.has(props.item.id)) {
      completedSet.delete(props.item.id);
    } else {
      completedSet.add(props.item.id);
    }
    _MD.commitWrites(_WRITES_);
  };
  _span.appendChild(_text);
  const _text2 = document.createTextNode("");
  if (_slot2 !== (_value = props.item.text)) {
    _slot2 = _value;
    _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span2 = document.createElement("span");
  _span2.className = "todo-text";
  _span2.appendChild(_text2);
  const _text3 = document.createTextNode("🏷️ ");
  const _text4 = document.createTextNode("");
  if (_slot3 !== (_value = categoryMap.get(props.item.id) || 'General')) {
    _slot3 = _value;
    _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span3 = document.createElement("span");
  _span3.className = "todo-badge";
  _span3.onclick = () => {
    const current = categoryMap.get(props.item.id) || 'Compiler';
    const nextCat = current === 'Compiler' ? 'Reactivity' : current === 'Reactivity' ? 'Performance' : 'Compiler';
    categoryMap.set(props.item.id, nextCat);
    _MD.commitWrites(_WRITES_2);
  };
  _span3.appendChild(_text3);
  _span3.appendChild(_text4);
  const _div = document.createElement("div");
  _div.className = "todo-content";
  _div.appendChild(_span);
  _div.appendChild(_span2);
  _div.appendChild(_span3);
  const _li = document.createElement("li");
  if (_slot4 !== (_value = completedSet.has(props.item.id) ? 'todo-item done' : 'todo-item')) {
    _slot4 = _value;
    _li.className = _value;
  }
  _li.appendChild(_div);
  return {
    nodes: [_li],
    entities: [],
    update: _update,
    updateProps: _nextProp => {
      props = _nextProp;
    }
  };
}
export function TodoApp(_id2, _parent) {
  let _slot5, _slot6, _slot7, _slot8, _value2;
  let timer = 0;
  const interval = setInterval(() => {
    timer++;
    _MD.markDirty(_id2);
  }, 1000);
  _MD.cleanup(_id2, () => {
    clearInterval(interval);
    console.log('interval cleared');
  });
  const _update2 = () => {
    if (_slot5 !== (_value2 = timer)) {
      _slot5 = _value2;
      _text6.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot6 !== (_value2 = totalCount)) {
      _slot6 = _value2;
      _text9.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot7 !== (_value2 = activeCount)) {
      _slot7 = _value2;
      _text1.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot8 !== (_value2 = completedCount)) {
      _slot8 = _value2;
      _text11.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    _region.reconcile(todos);
  };
  _MD.register({
    id: _id2,
    parent: _parent,
    render: _update2
  });
  const _text5 = document.createTextNode("⚡ Advanced Reactive Todo App timer-");
  const _text6 = document.createTextNode("");
  if (_slot5 !== (_value2 = timer)) {
    _slot5 = _value2;
    _text6.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _h = document.createElement("h1");
  _h.appendChild(_text5);
  _h.appendChild(_text6);
  const _text7 = document.createTextNode("Powered by Array, Set & Map Collections");
  const _p = document.createElement("p");
  _p.className = "subtitle";
  _p.appendChild(_text7);
  const _text8 = document.createTextNode("Total: ");
  const _text9 = document.createTextNode("");
  if (_slot6 !== (_value2 = totalCount)) {
    _slot6 = _value2;
    _text9.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _strong = document.createElement("strong");
  _strong.appendChild(_text9);
  const _div2 = document.createElement("div");
  _div2.className = "stat-pill";
  _div2.appendChild(_text8);
  _div2.appendChild(_strong);
  const _text0 = document.createTextNode("Active: ");
  const _text1 = document.createTextNode("");
  if (_slot7 !== (_value2 = activeCount)) {
    _slot7 = _value2;
    _text1.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _strong2 = document.createElement("strong");
  _strong2.appendChild(_text1);
  const _div3 = document.createElement("div");
  _div3.className = "stat-pill";
  _div3.appendChild(_text0);
  _div3.appendChild(_strong2);
  const _text10 = document.createTextNode("Completed: ");
  const _text11 = document.createTextNode("");
  if (_slot8 !== (_value2 = completedCount)) {
    _slot8 = _value2;
    _text11.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _strong3 = document.createElement("strong");
  _strong3.appendChild(_text11);
  const _div4 = document.createElement("div");
  _div4.className = "stat-pill";
  _div4.appendChild(_text10);
  _div4.appendChild(_strong3);
  const _div5 = document.createElement("div");
  _div5.className = "stats-bar";
  _div5.appendChild(_div2);
  _div5.appendChild(_div3);
  _div5.appendChild(_div4);
  const _text12 = document.createTextNode("➕ Add Task");
  const _button = document.createElement("button");
  _button.onclick = () => {
    const newId = Date.now();
    todos.push({
      id: newId,
      text: `New Task #${todos.length + 1}`
    });
    categoryMap.set(newId, 'General');
    _MD.commitWrites(_WRITES_3);
  };
  _button.appendChild(_text12);
  const _text13 = document.createTextNode("🧹 Clear Completed");
  const _button2 = document.createElement("button");
  _button2.onclick = () => {
    todos = todos.filter(t => {
      const _returnValue = !completedSet.has(t.id);
      _MD.commitWrites(_WRITES_);
      return _returnValue;
    });
    completedSet.clear();
    _MD.commitWrites(_WRITES_4);
  };
  _button2.appendChild(_text13);
  const _div6 = document.createElement("div");
  _div6.className = "actions";
  _div6.appendChild(_button);
  _div6.appendChild(_button2);
  const _ul = document.createElement("ul");
  const _region = _MD.createListRegion(_ul, _id2 + "/todos", (item, _rowId) => {
    const _entry = TodoItem({
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
  _region.reconcile(todos);
  const _div7 = document.createElement("div");
  _div7.className = "todo-card";
  _div7.appendChild(_h);
  _div7.appendChild(_p);
  _div7.appendChild(_div5);
  _div7.appendChild(_div6);
  _div7.appendChild(_ul);
  return _div7;
}
