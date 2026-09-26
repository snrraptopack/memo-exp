/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";

const _WRITES_ = [
	"./bench/dom/AppInline.tsx#selected",
	"./bench/dom/data.ts#nextId"
];

const _WRITES_2 = ["./bench/dom/AppInline.tsx#data"];

const _WRITES_3 = [
	"./bench/dom/AppInline.tsx#data",
	"./bench/dom/data.ts#nextId"
];

const _WRITES_4 = ["./bench/dom/AppInline.tsx#selected"];
let _liTemplate, _liTemplateDocument;

function _liCreateTemplate(_document2) {
	const _text10 = _document2.createTextNode("");
	const _li = _document2.createElement("li");

	_li.appendChild(_text10);

	return _li;
}

const _HTML_ = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul></ul></div>";

_MD.installAccessTable(
	{
		readers: {
			"./bench/dom/AppInline.tsx#data": ["BenchAppInline"],
			"./bench/dom/AppInline.tsx#data\u0000memo-dom:list-structure-reader": ["BenchAppInline"],
			"./bench/dom/AppInline.tsx#selected": ["BenchAppInline/data/Row[*]"]
		}
	},
	"BenchAppInline",
	"./bench/dom/AppInline.tsx"
);

import { buildData } from './data';

let data = [];
let selected = null;

export function BenchAppInline(_id, _parent, _dataPolicies) {
	let _value;

	const _update = (_reasons = null) => {
		_region.reconcile(data, _MD.isStructuralListUpdate(_reasons, "./bench/dom/AppInline.tsx#data"));
	};

	_MD.register({ id: _id, parent: _parent, render: _update });

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
			_MD.commitWrites(_WRITES_);
			_MD.commitStructuralWrites(_WRITES_2);
		}
	};

	_button2.onclick = () => {
		data = buildData(10000);
		selected = null;

		{
			_MD.commitWrites(_WRITES_);
			_MD.commitStructuralWrites(_WRITES_2);
		}
	};

	_button3.onclick = () => {
		data = data.concat(buildData(1000));
		_MD.commitWrites(_WRITES_3);
	};

	_button4.onclick = () => {
		data = buildData(1000).concat(data);
		_MD.commitWrites(_WRITES_3);
	};

	_button5.onclick = () => {
		data = data.slice(0, -1000);
		_MD.commitWrites(_WRITES_2);
	};

	_button6.onclick = () => {
		let _didWrite = false;

		for (let i = 0; i < data.length; i += 10) (_didWrite = true, data[i].label += ' !!!');

		{
			if (_didWrite) _MD.markDirtySubtree("BenchAppInline");
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
			if (_didWrite2 || _didWrite3) _MD.markDirtySubtree("BenchAppInline");
		}
	};

	_button8.onclick = () => {
		data.reverse();
		_MD.commitWrites(_WRITES_2);
	};

	_button9.onclick = () => {
		data.splice(500, 1);
		_MD.commitWrites(_WRITES_2);
	};

	_button0.onclick = () => {
		data = data.filter((_item, index) => index % 100 !== 0);
		_MD.commitWrites(_WRITES_2);
	};

	_button1.onclick = () => {
		data = [];
		selected = null;

		{
			_MD.commitWrites(_WRITES_4);
			_MD.commitStructuralWrites(_WRITES_2);
		}
	};

	const _onClickBinding = _MD.createDelegatedEventBinding(_ul, "onClick");

	const _region = _MD.createListRegion(
		_ul,
		_id + "/data",
		(item, _rowId) => {
			let _slot, _value2;

			const _update2 = () => {
				_MD.setTextData(_text10, item.id + ": " + item.label);

				if (_slot !== (_value2 = _MD.classValue(selected === item.id ? 'danger' : ''))) {
					_slot = _value2;
					_MD.setClassValue(_li, _value2);
				}
			};

			const _document2 = _MD.getActiveEnvironment().document;

			_MD.register({ id: _rowId, parent: _id, render: _update2 });

			const _canReuseTemplate = _MD.canReuseTemplate();
			let _li;

			if (_canReuseTemplate) {
				if (_liTemplate === void 0 || _liTemplateDocument !== _document2) {
					_liTemplateDocument = _document2;
					_liTemplate = _liCreateTemplate(_document2);
				}

				_li = _liTemplate.cloneNode(true);
			} else {
				_li = _liCreateTemplate(_document2);
			}

			const _text10 = _li.firstChild;

			_MD.setTextData(_text10, item.id + ": " + item.label);

			if (_slot !== (_value2 = _MD.classValue(selected === item.id ? 'danger' : ''))) {
				_slot = _value2;
				_MD.setClassValue(_li, _value2);
			}

			_MD.setDelegatedEvent(_onClickBinding, _li, () => {
				selected = item.id;
				_MD.commitWrites(_WRITES_4);
			});

			return {
				nodes: [_li],
				entities: [_rowId],
				updateProps: (_nextItem) => {
					item = _nextItem;
				},
				update: _update2
			};
		},
		(item) => item.id,
		true,
		false
	);

	_region.reconcile(data);

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
