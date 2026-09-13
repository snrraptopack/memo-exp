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
const _WRITES_4 = ["./bench/dom/data.ts#nextId"];

_MD.installAccessTable(
	{
		readers: {
			"./bench/dom/App.tsx#data": ["BenchApp", "BenchApp/*"],
			"./bench/dom/App.tsx#data\u0000memo-dom:list-structure-reader": ["BenchApp"],
			"./bench/dom/App.tsx#selected": ["BenchApp/data/Row[*]", "BenchApp/data/Row[*]/*"]
		}
	},
	"BenchApp",
	"./bench/dom/App.tsx"
);

import { buildData } from './data';

let data = [];
let selected = null;

function Row(props, _id, _onClickBinding) {
	let _slot, _slot2, _value;
	const _document = _MD.getActiveEnvironment().document;

	const _update = () => {
		if (_slot !== (_value = props.item.id + ": " + props.item.label)) {
			_slot = _value;
			_text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
		}

		if (_slot2 !== (_value = _MD.classValue(selected === props.item.id ? 'danger' : ''))) {
			_slot2 = _value;
			_MD.setClassValue(_li, _value);
		}
	};

	const _li = _MD.canReuseTemplate()
		? (_MD.canReuseTemplate() && (_liTemplate === void 0 || _liTemplateDocument !== _document)
			? (
				_liTemplateDocument = _document,
				_liTemplate = _liCreateTemplate(_document)
			)
			: _MD.canReuseTemplate() ? _liTemplate : _liCreateTemplate(_document)).cloneNode(true)
		: _MD.canReuseTemplate() && (_liTemplate === void 0 || _liTemplateDocument !== _document)
			? (
				_liTemplateDocument = _document,
				_liTemplate = _liCreateTemplate(_document)
			)
			: _MD.canReuseTemplate() ? _liTemplate : _liCreateTemplate(_document);

	const _text = _li.firstChild;

	if (_slot !== (_value = props.item.id + ": " + props.item.label)) {
		_slot = _value;
		_text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
	}

	if (_slot2 !== (_value = _MD.classValue(selected === props.item.id ? 'danger' : ''))) {
		_slot2 = _value;
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

export function BenchApp(_id2, _parent) {
	let _value2;
	const _document2 = _MD.getActiveEnvironment().document;

	const _update2 = (_reasons = null) => {
		_region.reconcile(data, _MD.isStructuralListUpdate(_reasons, "./bench/dom/App.tsx#data"));
	};

	_MD.register({ id: _id2, parent: _parent, render: _update2 });

	const _text2 = _document2.createTextNode("create1k");
	const _button = _document2.createElement("button");

	_button.onclick = () => {
		data = buildData(1000);
		selected = null;

		{
			_MD.commitWrites(_WRITES_2);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	_button.appendChild(_text2);

	const _text3 = _document2.createTextNode("create10k");
	const _button2 = _document2.createElement("button");

	_button2.onclick = () => {
		data = buildData(10000);
		selected = null;

		{
			_MD.commitWrites(_WRITES_2);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	_button2.appendChild(_text3);

	const _text4 = _document2.createTextNode("append1k");
	const _button3 = _document2.createElement("button");

	_button3.onclick = () => {
		data = data.concat(buildData(1000));

		{
			_MD.commitWrites(_WRITES_4);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	_button3.appendChild(_text4);

	const _text5 = _document2.createTextNode("prepend1k");
	const _button4 = _document2.createElement("button");

	_button4.onclick = () => {
		data = buildData(1000).concat(data);

		{
			_MD.commitWrites(_WRITES_4);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	_button4.appendChild(_text5);

	const _text6 = _document2.createTextNode("pop1k");
	const _button5 = _document2.createElement("button");

	_button5.onclick = () => {
		data = data.slice(0, -1000);
		_MD.commitStructuralWrites(_WRITES_3);
	};

	_button5.appendChild(_text6);

	const _text7 = _document2.createTextNode("update");
	const _button6 = _document2.createElement("button");

	_button6.onclick = () => {
		for (let i = 0; i < data.length; i += 10) data[i].label += ' !!!';

		_MD.commitWrites(_WRITES_3);
	};

	_button6.appendChild(_text7);

	const _text8 = _document2.createTextNode("swap");
	const _button7 = _document2.createElement("button");

	_button7.onclick = () => {
		if (data.length > 998) {
			const t = data[1];

			data[1] = data[998];
			data[998] = t;
		}

		_MD.commitStructuralWrites(_WRITES_3);
	};

	_button7.appendChild(_text8);

	const _text9 = _document2.createTextNode("reverse");
	const _button8 = _document2.createElement("button");

	_button8.onclick = () => {
		data.reverse();
		_MD.commitStructuralWrites(_WRITES_3);
	};

	_button8.appendChild(_text9);

	const _text0 = _document2.createTextNode("remove");
	const _button9 = _document2.createElement("button");

	_button9.onclick = () => {
		data.splice(500, 1);
		_MD.commitStructuralWrites(_WRITES_3);
	};

	_button9.appendChild(_text0);

	const _text1 = _document2.createTextNode("remove100");
	const _button0 = _document2.createElement("button");

	_button0.onclick = () => {
		data = data.filter((_item, index) => index % 100 !== 0);
		_MD.commitStructuralWrites(_WRITES_3);
	};

	_button0.appendChild(_text1);

	const _text10 = _document2.createTextNode("clear");
	const _button1 = _document2.createElement("button");

	_button1.onclick = () => {
		data = [];
		selected = null;

		{
			_MD.commitWrites(_WRITES_);
			_MD.commitStructuralWrites(_WRITES_3);
		}
	};

	_button1.appendChild(_text10);

	const _div = _document2.createElement("div");

	_MD.setClassValue(_div, "toolbar");
	_div.appendChild(_button);
	_div.appendChild(_button2);
	_div.appendChild(_button3);
	_div.appendChild(_button4);
	_div.appendChild(_button5);
	_div.appendChild(_button6);
	_div.appendChild(_button7);
	_div.appendChild(_button8);
	_div.appendChild(_button9);
	_div.appendChild(_button0);
	_div.appendChild(_button1);

	const _ul = _document2.createElement("ul");
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

	const _div2 = _document2.createElement("div");

	_div2.appendChild(_div);
	_div2.appendChild(_ul);

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
