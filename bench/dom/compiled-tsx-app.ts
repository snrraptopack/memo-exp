/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";

const _WRITES_ = ["./bench/dom/App.tsx#selected"];
let _liTemplate, _liTemplateDocument;

function _liCreateTemplate(_document) {
	const _text = _document.createTextNode("");
	const _li = _document.createElement("li");

	_li.appendChild(_text);

	return _li;
}

const _WRITES_2 = ["./bench/dom/App.tsx#selected", "./bench/dom/data.ts#nextId"];
const _WRITES_3 = ["./bench/dom/App.tsx#data"];
const _WRITES_4 = ["./bench/dom/App.tsx#data", "./bench/dom/data.ts#nextId"];
const _HTML_ = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul></ul></div>";

_MD.installAccessTable(
	{
		readers: {
			"./bench/dom/App.tsx#data": ["BenchApp"],
			"./bench/dom/App.tsx#data\u0000memo-dom:list-structure-reader": ["BenchApp"],
			"./bench/dom/App.tsx#selected": ["BenchApp/data/Row[*]"]
		}
	},
	"BenchApp",
	"./bench/dom/App.tsx"
);

import { buildData } from './data';

let data = [];
let selected = null;

function Row(props, _id, _onClickBinding) {
	let _slot, _value;
	const _document = _MD.getActiveEnvironment().document;

	const _update = () => {
		_MD.setTextData(_text, props.item.id + ": " + props.item.label);

		if (_slot !== (_value = _MD.classValue(selected === props.item.id ? 'danger' : ''))) {
			_slot = _value;
			_MD.setClassValue(_li, _value);
		}
	};

	const _canReuseTemplate = _MD.canReuseTemplate();
	let _li;

	if (_canReuseTemplate) {
		if (_liTemplate === void 0 || _liTemplateDocument !== _document) {
			_liTemplateDocument = _document;
			_liTemplate = _liCreateTemplate(_document);
		}

		_li = _liTemplate.cloneNode(true);
	} else {
		_li = _liCreateTemplate(_document);
	}

	const _text = _li.firstChild;

	_MD.setTextData(_text, props.item.id + ": " + props.item.label);

	if (_slot !== (_value = _MD.classValue(selected === props.item.id ? 'danger' : ''))) {
		_slot = _value;
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
		updateProps: (_nextProp) => {
			props = _nextProp;
		}
	};
}

export function BenchApp(_id2, _parent, _dataPolicies) {
	let _value2;

	const _update2 = (_reasons = null) => {
		_region.reconcile(data, _MD.isStructuralListUpdate(_reasons, "./bench/dom/App.tsx#data"));
	};

	_MD.register({ id: _id2, parent: _parent, render: _update2 });

	const _markup = _MD.materializeMarkup(_HTML_);
	const _button = _markup[1];
	const _button2 = _markup[3];
	const _button3 = _markup[5];
	const _button4 = _markup[7];
	const _button5 = _markup[9];
	const _button6 = _markup[11];
	const _button7 = _markup[13];
	const _button8 = _markup[15];
	const _button9 = _markup[17];
	const _button0 = _markup[19];
	const _button1 = _markup[21];
	const _ul = _markup[23];
	const _div2 = _markup[24];

	_button.onclick = () => {
		data = buildData(1000);
		selected = null;

		{
			_MD.commitWrites(_WRITES_2);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	_button2.onclick = () => {
		data = buildData(10000);
		selected = null;

		{
			_MD.commitWrites(_WRITES_2);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	_button3.onclick = () => {
		data = data.concat(buildData(1000));
		_MD.commitWrites(_WRITES_4);
	};

	_button4.onclick = () => {
		data = buildData(1000).concat(data);
		_MD.commitWrites(_WRITES_4);
	};

	_button5.onclick = () => {
		data = data.slice(0, -1000);
		_MD.commitWrites(_WRITES_3);
	};

	_button6.onclick = () => {
		let _didWrite = false;

		for (let i = 0; i < data.length; i += 10) (_didWrite = true, data[i].label += ' !!!');

		{
			if (_didWrite) _MD.markDirtySubtree("BenchApp");
		}
	};

	_button7.onclick = () => {
		let _didWrite2 = false, _didWrite3 = false;

		if (data.length > 998) {
			const t = data[1];

			(_didWrite2 = true, data[1] = data[998]);
			(_didWrite3 = true, data[998] = t);
		}

		{
			if (_didWrite2 || _didWrite3) _MD.markDirtySubtree("BenchApp");
		}
	};

	_button8.onclick = () => {
		data.reverse();
		_MD.commitWrites(_WRITES_3);
	};

	_button9.onclick = () => {
		data.splice(500, 1);
		_MD.commitWrites(_WRITES_3);
	};

	_button0.onclick = () => {
		data = data.filter((_item, index) => index % 100 !== 0);
		_MD.commitWrites(_WRITES_3);
	};

	_button1.onclick = () => {
		data = [];
		selected = null;

		{
			_MD.commitWrites(_WRITES_);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	const _onClickBinding2 = _MD.createDelegatedEventBinding(_ul, "onClick");

	const _region = _MD.createListRegion(
		_ul,
		_id2 + "/data",
		(item, _rowId) => {
			const _entry = Row({ item }, _rowId, _onClickBinding2);
			const _pushRowProps = _entry.updateProps;

			_entry.updateProps = (_nextItem) => {
				item = _nextItem;
				_pushRowProps({ item });
			};

			return _entry;
		},
		(item) => item.id,
		false,
		false
	);

	_region.reconcile(data);

	return _div2;
}

_MD.registerRootFactory(BenchApp, { id: "BenchApp", create: () => BenchApp("BenchApp", null, []) });

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
