// @ts-nocheck
/**
 * Generated Compiled Output for examples/todo.tsx
 */
import * as _MD from "../src/runtime";
const _WRITES_ = ["./component.tsx#completedSet", "./component.tsx#isLoading", "./component.tsx#statusMessage", "./component.tsx#todos"];
const _WRITES_2 = ["./component.tsx#completedSet"];
const _WRITES_3 = ["./component.tsx#categoryMap"];
const _WRITES_4 = ["./component.tsx#categoryMap", "./component.tsx#todos"];
const _WRITES_5 = ["./component.tsx#completedSet", "./component.tsx#todos"];
const _WRITES_6 = ["./component.tsx#totalCount"];
const _WRITES_7 = ["./component.tsx#completedCount"];
const _WRITES_8 = ["./component.tsx#activeCount"];
_MD.installAccessTable({
  readers: {
    "./component.tsx#activeCount": ["TodoApp", "TodoApp/*"],
    "./component.tsx#categoryMap": ["TodoApp", "TodoApp/*"],
    "./component.tsx#completedCount": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#activeCount", "TodoApp/*"],
    "./component.tsx#completedSet": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#completedCount", "TodoApp/*"],
    "./component.tsx#isLoading": ["TodoApp", "TodoApp/*"],
    "./component.tsx#statusMessage": ["TodoApp", "TodoApp/*"],
    "./component.tsx#todos": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#totalCount", "TodoApp/*"],
    "./component.tsx#totalCount": ["TodoApp", "TodoApp/$computed/.%2Fcomponent.tsx#activeCount", "TodoApp/*"]
  }
}, "TodoApp");
// 1. Module-Level State (Rule R7 L1 List Compliance)
let todos = [{
  id: 1,
  text: 'Master Memoized DOM Compiler'
}, {
  id: 2,
  text: 'Test Real-World Async API Fetching'
}, {
  id: 3,
  text: 'Verify Zero-Import Reactivity'
}];
let isLoading = false;
let statusMessage = 'Ready';

// 2. Set & Map Collections
const completedSet = new Set([1]);
const categoryMap = new Map([[1, 'Compiler'], [2, 'Network'], [3, 'Performance']]);

// 3. Computed Derivations (Rule R13)
let totalCount = todos.length;
_MD.register({
  id: "TodoApp/$computed/.%2Fcomponent.tsx#totalCount",
  parent: null,
  depth: -1,
  render: () => {
    const _totalCountNext = todos.length;
    if (_MD.computedChanged(totalCount, _totalCountNext)) {
      totalCount = _totalCountNext;
      _MD.commitWrites(_WRITES_6);
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
      _MD.commitWrites(_WRITES_7);
    }
  }
});
let activeCount = totalCount - completedCount;

// 4. Async API Fetch Handler
_MD.register({
  id: "TodoApp/$computed/.%2Fcomponent.tsx#activeCount",
  parent: null,
  depth: -1,
  render: () => {
    const _activeCountNext = totalCount - completedCount;
    if (_MD.computedChanged(activeCount, _activeCountNext)) {
      activeCount = _activeCountNext;
      _MD.commitWrites(_WRITES_8);
    }
  }
});
async function fetchRemoteTodos() {
  isLoading = true;
  statusMessage = 'Fetching 10 live todos from JSONPlaceholder API...';
  try {
    const res = await fetch('https://jsonplaceholder.typicode.com/todos?_limit=10');
    const data = await res.json();
    todos = data.map(item => ({
      id: item.id + 100,
      text: item.title
    }));
    completedSet.clear();
    data.forEach(item => {
      if (item.completed) completedSet.add(item.id + 100);
      _MD.commitWrites(_WRITES_2);
    });
    statusMessage = 'Successfully loaded remote API todos!';
  } catch (err) {
    statusMessage = 'Failed to fetch remote todos!';
  } finally {
    isLoading = false;
  }
  _MD.commitWrites(_WRITES_);
}

// 5. Item Component
function TodoItem(props, _id) {
  let _slot, _slot2, _slot3, _slot4, _value;
  let isDone = completedSet.has(props.item.id);
  let category = categoryMap.get(props.item.id) || 'General';
  const _update = () => {
    {
      isDone = completedSet.has(props.item.id);
      category = categoryMap.get(props.item.id) || 'General';
    }
    if (_slot !== (_value = isDone ? '☑' : '☐')) {
      _slot = _value;
      _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot2 !== (_value = props.item.text)) {
      _slot2 = _value;
      _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot3 !== (_value = category)) {
      _slot3 = _value;
      _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot4 !== (_value = isDone ? 'todo-item done' : 'todo-item')) {
      _slot4 = _value;
      _li.className = _value;
    }
  };
  const _text = document.createTextNode("");
  if (_slot !== (_value = isDone ? '☑' : '☐')) {
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
    _MD.commitWrites(_WRITES_2);
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
  if (_slot3 !== (_value = category)) {
    _slot3 = _value;
    _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span3 = document.createElement("span");
  _span3.className = "todo-badge";
  _span3.onclick = () => {
    const nextCat = category === 'Compiler' ? 'Network' : category === 'Network' ? 'Performance' : 'Compiler';
    categoryMap.set(props.item.id, nextCat);
    _MD.commitWrites(_WRITES_3);
  };
  _span3.appendChild(_text3);
  _span3.appendChild(_text4);
  const _div = document.createElement("div");
  _div.className = "todo-content";
  _div.appendChild(_span);
  _div.appendChild(_span2);
  _div.appendChild(_span3);
  const _li = document.createElement("li");
  if (_slot4 !== (_value = isDone ? 'todo-item done' : 'todo-item')) {
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

// 6. Main Application Component
export function TodoApp(_id2, _parent) {
  let _slot5, _slot6, _slot7, _slot8, _slot9, _slot0, _value2;
  const _update2 = () => {
    if (_slot5 !== (_value2 = statusMessage)) {
      _slot5 = _value2;
      _text6.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot6 !== (_value2 = totalCount)) {
      _slot6 = _value2;
      _text8.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot7 !== (_value2 = activeCount)) {
      _slot7 = _value2;
      _text0.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot8 !== (_value2 = completedCount)) {
      _slot8 = _value2;
      _text10.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot9 !== (_value2 = isLoading ? '⏳ Loading API...' : '🌐 Load Remote API Todos')) {
      _slot9 = _value2;
      _text11.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot0 !== (_value2 = isLoading)) {
      _slot0 = _value2;
      _button.disabled = _value2;
    }
    _region.reconcile(todos);
  };
  _MD.register({
    id: _id2,
    parent: _parent,
    render: _update2
  });
  const _text5 = document.createTextNode("⚡ Advanced Reactive Todo App");
  const _h = document.createElement("h1");
  _h.appendChild(_text5);
  const _text6 = document.createTextNode("");
  if (_slot5 !== (_value2 = statusMessage)) {
    _slot5 = _value2;
    _text6.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _p = document.createElement("p");
  _p.className = "subtitle";
  _p.appendChild(_text6);
  const _text7 = document.createTextNode("Total: ");
  const _text8 = document.createTextNode("");
  if (_slot6 !== (_value2 = totalCount)) {
    _slot6 = _value2;
    _text8.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _strong = document.createElement("strong");
  _strong.appendChild(_text8);
  const _div2 = document.createElement("div");
  _div2.className = "stat-pill";
  _div2.appendChild(_text7);
  _div2.appendChild(_strong);
  const _text9 = document.createTextNode("Active: ");
  const _text0 = document.createTextNode("");
  if (_slot7 !== (_value2 = activeCount)) {
    _slot7 = _value2;
    _text0.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _strong2 = document.createElement("strong");
  _strong2.appendChild(_text0);
  const _div3 = document.createElement("div");
  _div3.className = "stat-pill";
  _div3.appendChild(_text9);
  _div3.appendChild(_strong2);
  const _text1 = document.createTextNode("Completed: ");
  const _text10 = document.createTextNode("");
  if (_slot8 !== (_value2 = completedCount)) {
    _slot8 = _value2;
    _text10.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _strong3 = document.createElement("strong");
  _strong3.appendChild(_text10);
  const _div4 = document.createElement("div");
  _div4.className = "stat-pill";
  _div4.appendChild(_text1);
  _div4.appendChild(_strong3);
  const _div5 = document.createElement("div");
  _div5.className = "stats-bar";
  _div5.appendChild(_div2);
  _div5.appendChild(_div3);
  _div5.appendChild(_div4);
  const _text11 = document.createTextNode("");
  if (_slot9 !== (_value2 = isLoading ? '⏳ Loading API...' : '🌐 Load Remote API Todos')) {
    _slot9 = _value2;
    _text11.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  const _button = document.createElement("button");
  _button.onclick = () => {
    fetchRemoteTodos();
    _MD.commitWrites(_WRITES_);
  };
  if (_slot0 !== (_value2 = isLoading)) {
    _slot0 = _value2;
    _button.disabled = _value2;
  }
  _button.appendChild(_text11);
  const _text12 = document.createTextNode("➕ Add Task");
  const _button2 = document.createElement("button");
  _button2.onclick = () => {
    const newId = Date.now();
    todos.push({
      id: newId,
      text: `New Task #${todos.length + 1}`
    });
    categoryMap.set(newId, 'General');
    _MD.commitWrites(_WRITES_4);
  };
  _button2.appendChild(_text12);
  const _text13 = document.createTextNode("🧹 Clear Completed");
  const _button3 = document.createElement("button");
  _button3.onclick = () => {
    todos = todos.filter(t => {
      const _returnValue = !completedSet.has(t.id);
      _MD.commitWrites(_WRITES_2);
      return _returnValue;
    });
    completedSet.clear();
    _MD.commitWrites(_WRITES_5);
  };
  _button3.appendChild(_text13);
  const _div6 = document.createElement("div");
  _div6.className = "actions";
  _div6.appendChild(_button);
  _div6.appendChild(_button2);
  _div6.appendChild(_button3);
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
