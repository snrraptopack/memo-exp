// @ts-nocheck
/**
 * Generated Compiled Output for examples/todo.tsx
 */
import * as MD from "../src/runtime";
const WRITES_0 = ["./component.tsx#completedSet"];
const WRITES_1 = ["./component.tsx#categoryMap"];
const WRITES_2 = ["./component.tsx#categoryMap", "./component.tsx#todos"];
const WRITES_3 = ["./component.tsx#completedSet", "./component.tsx#todos"];
const WRITES_4 = ["./component.tsx#totalCount"];
const WRITES_5 = ["./component.tsx#completedCount"];
const WRITES_6 = ["./component.tsx#activeCount"];
MD.installAccessTable({
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
MD.register({
  id: "TodoApp/$computed/.%2Fcomponent.tsx#totalCount",
  parent: null,
  depth: -1,
  render: () => {
    const next = todos.length;
    if (MD.computedChanged(totalCount, next)) {
      totalCount = next;
      MD.commitWrites(WRITES_4);
    }
  }
});
let completedCount = completedSet.size;
MD.register({
  id: "TodoApp/$computed/.%2Fcomponent.tsx#completedCount",
  parent: null,
  depth: -1,
  render: () => {
    const next = completedSet.size;
    if (MD.computedChanged(completedCount, next)) {
      completedCount = next;
      MD.commitWrites(WRITES_5);
    }
  }
});
let activeCount = totalCount - completedCount;
MD.register({
  id: "TodoApp/$computed/.%2Fcomponent.tsx#activeCount",
  parent: null,
  depth: -1,
  render: () => {
    const next = totalCount - completedCount;
    if (MD.computedChanged(activeCount, next)) {
      activeCount = next;
      MD.commitWrites(WRITES_6);
    }
  }
});
function TodoItem(props, __memoRowId) {
  let $s0, $s1, $s2, $s3, $t;
  const update = () => {
    if ($s0 !== ($t = completedSet.has(props.item.id) ? '☑' : '☐')) {
      $s0 = $t;
      text0.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s1 !== ($t = props.item.text)) {
      $s1 = $t;
      text1.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s2 !== ($t = categoryMap.get(props.item.id) || 'General')) {
      $s2 = $t;
      text3.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s3 !== ($t = completedSet.has(props.item.id) ? 'todo-item done' : 'todo-item')) {
      $s3 = $t;
      li0.className = $t;
    }
  };
  const text0 = document.createTextNode("");
  if ($s0 !== ($t = completedSet.has(props.item.id) ? '☑' : '☐')) {
    $s0 = $t;
    text0.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const span0 = document.createElement("span");
  span0.className = "todo-check";
  span0.onclick = () => {
    if (completedSet.has(props.item.id)) {
      completedSet.delete(props.item.id);
    } else {
      completedSet.add(props.item.id);
    }
    MD.commitWrites(WRITES_0);
  };
  span0.appendChild(text0);
  const text1 = document.createTextNode("");
  if ($s1 !== ($t = props.item.text)) {
    $s1 = $t;
    text1.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const span1 = document.createElement("span");
  span1.className = "todo-text";
  span1.appendChild(text1);
  const text2 = document.createTextNode("🏷️ ");
  const text3 = document.createTextNode("");
  if ($s2 !== ($t = categoryMap.get(props.item.id) || 'General')) {
    $s2 = $t;
    text3.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const span2 = document.createElement("span");
  span2.className = "todo-badge";
  span2.onclick = () => {
    const current = categoryMap.get(props.item.id) || 'Compiler';
    const nextCat = current === 'Compiler' ? 'Reactivity' : current === 'Reactivity' ? 'Performance' : 'Compiler';
    categoryMap.set(props.item.id, nextCat);
    MD.commitWrites(WRITES_1);
  };
  span2.appendChild(text2);
  span2.appendChild(text3);
  const div0 = document.createElement("div");
  div0.className = "todo-content";
  div0.appendChild(span0);
  div0.appendChild(span1);
  div0.appendChild(span2);
  const li0 = document.createElement("li");
  if ($s3 !== ($t = completedSet.has(props.item.id) ? 'todo-item done' : 'todo-item')) {
    $s3 = $t;
    li0.className = $t;
  }
  li0.appendChild(div0);
  return {
    nodes: [li0],
    entities: [],
    update: update,
    updateProps: __memoNext0 => {
      props = __memoNext0;
    }
  };
}
export function TodoApp(id, parent) {
  let $s0, $s1, $s2, $t;
  const update = () => {
    if ($s0 !== ($t = totalCount)) {
      $s0 = $t;
      text3.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s1 !== ($t = activeCount)) {
      $s1 = $t;
      text5.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s2 !== ($t = completedCount)) {
      $s2 = $t;
      text7.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    region0.reconcile(todos);
  };
  MD.register({
    id: id,
    parent: parent,
    render: update
  });
  const text0 = document.createTextNode("⚡ Advanced Reactive Todo App");
  const h10 = document.createElement("h1");
  h10.appendChild(text0);
  const text1 = document.createTextNode("Powered by Array, Set & Map Collections");
  const p0 = document.createElement("p");
  p0.className = "subtitle";
  p0.appendChild(text1);
  const text2 = document.createTextNode("Total: ");
  const text3 = document.createTextNode("");
  if ($s0 !== ($t = totalCount)) {
    $s0 = $t;
    text3.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const strong0 = document.createElement("strong");
  strong0.appendChild(text3);
  const div0 = document.createElement("div");
  div0.className = "stat-pill";
  div0.appendChild(text2);
  div0.appendChild(strong0);
  const text4 = document.createTextNode("Active: ");
  const text5 = document.createTextNode("");
  if ($s1 !== ($t = activeCount)) {
    $s1 = $t;
    text5.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const strong1 = document.createElement("strong");
  strong1.appendChild(text5);
  const div1 = document.createElement("div");
  div1.className = "stat-pill";
  div1.appendChild(text4);
  div1.appendChild(strong1);
  const text6 = document.createTextNode("Completed: ");
  const text7 = document.createTextNode("");
  if ($s2 !== ($t = completedCount)) {
    $s2 = $t;
    text7.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const strong2 = document.createElement("strong");
  strong2.appendChild(text7);
  const div2 = document.createElement("div");
  div2.className = "stat-pill";
  div2.appendChild(text6);
  div2.appendChild(strong2);
  const div3 = document.createElement("div");
  div3.className = "stats-bar";
  div3.appendChild(div0);
  div3.appendChild(div1);
  div3.appendChild(div2);
  const text8 = document.createTextNode("➕ Add Task");
  const button0 = document.createElement("button");
  button0.onclick = () => {
    const newId = Date.now();
    todos.push({
      id: newId,
      text: `New Task #${todos.length + 1}`
    });
    categoryMap.set(newId, 'General');
    MD.commitWrites(WRITES_2);
  };
  button0.appendChild(text8);
  const text9 = document.createTextNode("🧹 Clear Completed");
  const button1 = document.createElement("button");
  button1.onclick = () => {
    todos = todos.filter(t => !completedSet.has(t.id));
    completedSet.clear();
    MD.commitWrites(WRITES_3);
  };
  button1.appendChild(text9);
  const div4 = document.createElement("div");
  div4.className = "actions";
  div4.appendChild(button0);
  div4.appendChild(button1);
  const ul0 = document.createElement("ul");
  const region0 = MD.createListRegion(ul0, id + "/todos", (item, rowId) => {
    const entry = TodoItem({
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
  region0.reconcile(todos);
  const div5 = document.createElement("div");
  div5.className = "todo-card";
  div5.appendChild(h10);
  div5.appendChild(p0);
  div5.appendChild(div3);
  div5.appendChild(div4);
  div5.appendChild(ul0);
  return div5;
}
