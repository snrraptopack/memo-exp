/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";

const _WRITES_ = ["./bench/dom/AppModuleSelectionComponent.tsx#selected"];
let _liTemplate, _liTemplateDocument;

function _liCreateTemplate(_document) {
	const _text = _document.createTextNode("");
	const _li = _document.createElement("li");

	_li.appendChild(_text);

	return _li;
}

const _REASONS_ = [1, 2];

const _WRITES_2 = [
	"./bench/dom/AppModuleSelectionComponent.tsx#selected",
	"./bench/dom/data.ts#nextId"
];

const _WRITES_3 = ["./bench/dom/data.ts#nextId"];

const _WRITES_4 = [
	"./bench/dom/data.ts#adjectives",
	"./bench/dom/data.ts#colours",
	"./bench/dom/data.ts#nextId",
	"./bench/dom/data.ts#nouns"
];

const _HTML_ = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul></ul></div>";

_MD.installAccessTable(
	{
		readers: {
			"./bench/dom/AppModuleSelectionComponent.tsx#selected": ["BenchModuleSelectionComponent/data/$selection"]
		}
	},
	"BenchModuleSelectionComponent",
	"./bench/dom/AppModuleSelectionComponent.tsx"
);

import { buildData } from './data';

let selected = null;

function Row(_rowProp, _id, _owner, _onClickBinding) {
	let _slot, _slot2, _slot3, _slot4, _slot5, _value;
	const _document = _MD.getActiveEnvironment().document;

	const _update = () => {
		{
			const _textLeft = _rowProp.id;

			if (typeof _textLeft === "number" || typeof _textLeft === "string") {
				const _textRight = _rowProp.label;

				if (typeof _textRight === "number" || typeof _textRight === "string") {
					if (!_slot4 || (_slot2 !== _textLeft || _slot3 !== _textRight)) {
						_slot2 = _textLeft;
						_slot3 = _textRight;
						_slot4 = true;

						if (_slot !== (_value = _MD.textValue(_textLeft + ": " + _textRight))) {
							_slot = _value;
							_text.data = _value;
						}
					}
				} else try {
					if (_slot !== (_value = _MD.textValue(_textLeft + ": " + _textRight))) {
						_slot = _value;
						_text.data = _value;
					}
				} finally {
					_slot4 = false;
				}
			} else try {
				if (_slot !== (_value = _MD.textValue(_textLeft + ": " + _rowProp.label))) {
					_slot = _value;
					_text.data = _value;
				}
			} finally {
				_slot4 = false;
			}
		}

		if (_slot5 !== (_value = selected === _rowProp.id ? "danger" : "")) {
			_slot5 = _value;
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

	{
		const _textLeft = _rowProp.id;

		if (typeof _textLeft === "number" || typeof _textLeft === "string") {
			const _textRight = _rowProp.label;

			if (typeof _textRight === "number" || typeof _textRight === "string") {
				{
					_slot2 = _textLeft;
					_slot3 = _textRight;
					_slot4 = true;
					_slot = _MD.textValue(_textLeft + ": " + _textRight);
				}
			} else try {
				_slot = _MD.textValue(_textLeft + ": " + _textRight);
			} finally {
				_slot4 = false;
			}
		} else try {
			_slot = _MD.textValue(_textLeft + ": " + _rowProp.label);
		} finally {
			_slot4 = false;
		}
	}

	_MD.setTextData(_text, _slot);

	if (_slot5 !== (_value = selected === _rowProp.id ? "danger" : "")) {
		_slot5 = _value;
		_MD.setClassValue(_li, _value);
	}

	_MD.setDelegatedEvent(_onClickBinding, _li, () => {
		selected = _rowProp.id;
		_MD.commitWrites(_WRITES_);
	});

	return {
		nodes: _li,
		entities: [],
		update: _update,
		updateProps: (_nextProp) => {
			_rowProp = _nextProp;
		}
	};
}

export function BenchModuleSelectionComponent(_id2, _parent, _dataPolicies) {
	let _value2;
	let data = [];

	const _update2 = (_reasons = null) => {
		if (!_MD.reasonsOnly(_reasons, [0, 2]) || (_reasons === 1 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(1))) || (_reasons === 2 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(2))) && !(_reasons === 0 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(0)))) {
			_region.reconcile(data, _MD.isStructuralListUpdate(_reasons, ""));
			_dataChangedKeys.clear();
		} else {
			if (_reasons === 0 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(0))) {
				for (const _changedListKey of _dataChangedKeys) {
					_region.refreshKey(_changedListKey);
				}

				_dataChangedKeys.clear();
			}
		}
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
			_MD.markDirty(_id2, _REASONS_);
			_MD.commitWrites(_WRITES_2);
		}
	};

	_button2.onclick = () => {
		data = buildData(10000);
		selected = null;

		{
			_MD.markDirty(_id2, _REASONS_);
			_MD.commitWrites(_WRITES_2);
		}
	};

	_button3.onclick = () => {
		data = data.concat(buildData(1000));

		{
			_MD.markDirty(_id2, _REASONS_);
			_MD.commitWrites(_WRITES_3);
		}
	};

	_button4.onclick = () => {
		data = buildData(1000).concat(data);

		{
			_MD.markDirty(_id2, _REASONS_);
			_MD.commitWrites(_WRITES_4);
		}
	};

	_button5.onclick = () => {
		data = data.slice(0, -1000);
		_MD.markDirty(_id2, _REASONS_);
	};

	_button6.onclick = () => {
		let _didWrite = false;

		for (let i = 0; i < data.length; i += 10) (_didWrite = true, data[i].label += ' !!!');

		{
			if (_didWrite) _MD.markDirtySubtree("BenchModuleSelectionComponent", _id2, _REASONS_);
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
			if (_didWrite2 || _didWrite3) _MD.markDirtySubtree("BenchModuleSelectionComponent", _id2, _REASONS_);
		}
	};

	_button8.onclick = () => {
		data.reverse();
		_MD.markDirty(_id2, _REASONS_);
	};

	_button9.onclick = () => {
		data.splice(500, 1);
		_MD.markDirty(_id2, _REASONS_);
	};

	_button0.onclick = () => {
		data = data.filter((_item, index) => index % 100 !== 0);
		_MD.markDirty(_id2, _REASONS_);
	};

	_button1.onclick = () => {
		data = [];
		selected = null;

		{
			_MD.markDirty(_id2, _REASONS_);
			_MD.commitWrites(_WRITES_);
		}
	};

	const _onClickBinding2 = _MD.createDelegatedEventBinding(_ul, "onClick");

	const _region = _MD.createListRegion(
		_ul,
		_id2 + "/data",
		(item, _rowId) => {
			const _entry = Row(item, _rowId, _id2, _onClickBinding2);
			const _pushRowProps = _entry.updateProps;

			_entry.updateProps = (_nextItem) => {
				item = _nextItem;
				_pushRowProps(item);
			};

			return _entry;
		},
		(item) => item.id,
		false,
		false
	);

	const _listSelectionId = _id2 + "/data/$selection";
	let _selectedModuleListKey = selected;

	_MD.register({
		id: _listSelectionId,
		parent: _id2,
		render: () => {
			if (!Object.is(_selectedModuleListKey, selected)) {
				const _previousModuleListKey = _selectedModuleListKey;

				_selectedModuleListKey = selected;
				_region.refreshKey(_previousModuleListKey);
				_region.refreshKey(_selectedModuleListKey);
			}
		}
	});

	const _disposeList = _region.dispose;

	_region.dispose = () => {
		_MD.unregister(_listSelectionId);
		_disposeList();
	};

	const _dataChangedKeys = new Set();

	_region.reconcile(data);

	return _div2;
}

_MD.registerRootFactory(BenchModuleSelectionComponent, {
	id: "BenchModuleSelectionComponent",
	create: () => BenchModuleSelectionComponent("BenchModuleSelectionComponent", null, [])
});

export function createModuleSelectionComponent() {
  const root = BenchModuleSelectionComponent('BenchModuleSelectionComponent', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppModuleSelectionComponent`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
