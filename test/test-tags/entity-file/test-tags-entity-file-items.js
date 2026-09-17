import {EntityFileHandlerBase} from "./test-tags-entity-file-base.js";

export class EntityFileHandlerItems extends EntityFileHandlerBase {
	static _SOURCES_ONE_CORE = new Set([
		Parser.SRC_XPHB,
		Parser.SRC_XDMG,
		Parser.SRC_XMM,
	]);
	static _SOURCES_ONE_REFERENCE = [
		Parser.SRC_XPHB,
		Parser.SRC_XDMG,
	];

	_props = [
		"baseitem",
		"item",
		"itemGroup",
		"magicvariant",
	];

	/**
	 * @param file
	 * @param name
	 * @param source
	 * @param arr
	 * @param prop
	 * @param tag
	 * @param {?string} propEntity
	 */
	_checkArrayDuplicates ({file, name, source, arr, prop, tag, propEntity = null}) {
		const asUrls = arr
			.map(it => {
				if (it.item) it = it.item;
				if (it.uid) it = it.uid;
				if (it.special) return null;

				return this._tagTestUrlLookup.getEncodedProxy(it, tag, propEntity);
			})
			.filter(Boolean);

		if (asUrls.length !== new Set(asUrls).size) {
			this._addMessage(`Duplicate ${prop} in ${file} for ${source}, ${name}: ${asUrls.filter(s => asUrls.filter(it => it === s).length > 1).join(", ")}\n`);
		}
	}

	/**
	 * @param file
	 * @param name
	 * @param source
	 * @param arr
	 * @param prop
	 * @param tag
	 * @param {?string} propEntity
	 */
	_checkArrayItemsExist ({file, name, source, arr, prop, tag, propEntity = null}) {
		arr.forEach(it => {
			if (it.item) it = it.item;
			if (it.uid) it = it.uid;
			if (it.special) return;

			if (tag === "spell") it = this._getCleanSpellUid(it);

			const url = this._tagTestUrlLookup.getEncodedProxy(it, tag, propEntity);
			if (!this._tagTestUrlLookup.hasUrl(url)) this._addMessage(`Missing link: ${it} in file ${file} (evaluates to "${url}") in "${prop}"\n${this._tagTestUrlLookup.getLogPtSimilarUrls({url})}`);
		});
	}

	_checkReqAttuneTags (file, root, name, source, prop) {
		const tagsArray = root[prop];

		tagsArray.forEach(tagBlock => {
			Object.entries(tagBlock)
				.forEach(([prop, val]) => {
					switch (prop) {
						case "background":
						case "race":
						case "class": {
							const url = this._tagTestUrlLookup.getEncodedProxy(val, prop);
							if (!this._tagTestUrlLookup.hasUrl(url)) this._addMessage(`Missing link: ${val} in file ${file} "${prop}" (evaluates to "${url}")\n${this._tagTestUrlLookup.getLogPtSimilarUrls({url})}`);
						}
					}
				});
		});
	}

	_getUidString (uid) {
		if (typeof uid === "object") uid = uid?.uid;
		return typeof uid === "string" ? uid : null;
	}

	_isOneSourceUid (uid) {
		uid = this._getUidString(uid);
		if (!uid) return false;

		const sourceUid = uid.split("|")[1];
		if (!sourceUid) return false;

		return this.constructor._SOURCES_ONE_CORE
			.has(Parser.sourceJsonToJson(sourceUid));
	}

	_isOneItemContext ({root, source}) {
		if (this.constructor._SOURCES_ONE_CORE.has(source)) return true;
		if (root.edition === "one") return true;
		if (this._isOneSourceUid(root.baseItem)) return true;
		if (this._isOneSourceUid(root.type)) return true;
		if (root.property?.some(it => this._isOneSourceUid(it))) return true;
		if (root.mastery?.some(it => this._isOneSourceUid(it))) return true;
		return false;
	}

	_checkSourceVersionedUid ({file, name, source, uid, prop, fnUnpackUid, fnGetEntity, isOneItemContext}) {
		if (!isOneItemContext) return;
		uid = this._getUidString(uid);
		if (!uid) return;

		// Only guard against implicit legacy defaults. Explicit cross-edition references are intentional.
		if (uid.split("|")[1]) return;

		const {abbreviation, source: sourceUid} = fnUnpackUid(uid);
		if (sourceUid !== Parser.SRC_PHB) return;

		const sourceModern = this.constructor._SOURCES_ONE_REFERENCE
			.find(sourceCandidate => {
				const uidCandidate = `${abbreviation}|${sourceCandidate}`;
				const entCandidate = fnGetEntity(uidCandidate, {isIgnoreMissing: true});
				return entCandidate?.source === sourceCandidate;
			});
		if (!sourceModern) return;

		const uidModern = `${abbreviation}|${sourceModern}`;

		this._addMessage(`Prior-edition ${prop} reference: ${uid} in ${file} for ${source}, ${name}; resolves to ${Parser.SRC_PHB} while ${uidModern} exists\n`);
	}

	_checkSourceVersionedUidValue ({file, name, source, value, prop, fnUnpackUid, fnGetEntity, isOneItemContext}) {
		(value instanceof Array ? value : [value])
			.filter(Boolean)
			.forEach(uid => this._checkSourceVersionedUid({file, name, source, uid, prop, fnUnpackUid, fnGetEntity, isOneItemContext}));
	}

	_checkSourceVersionedStructuredRefs ({file, name, source, root, isOneItemContext}) {
		if (!root) return;

		if (root.type) {
			this._checkSourceVersionedUidValue({
				file,
				name,
				source,
				value: root.type,
				prop: "item type",
				fnUnpackUid: DataUtil.itemType.unpackUid.bind(DataUtil.itemType),
				fnGetEntity: Renderer.item.getType.bind(Renderer.item),
				isOneItemContext,
			});
		}

		for (const propRoot of ["property", "propertyAdd"]) {
			if (!root[propRoot]) continue;

			this._checkSourceVersionedUidValue({
				file,
				name,
				source,
				value: root[propRoot],
				prop: "item property",
				fnUnpackUid: DataUtil.itemProperty.unpackUid.bind(DataUtil.itemProperty),
				fnGetEntity: Renderer.item.getProperty.bind(Renderer.item),
				isOneItemContext,
			});
		}
	}

	_checkRoot (file, root, name, source, {isOneItemContext = null} = {}) {
		if (!root) return;

		this._testSrd(file, root);
		isOneItemContext ??= this._isOneItemContext({root, source});

		this._checkSourceVersionedStructuredRefs({file, name, source, root, isOneItemContext});
		root.requires?.forEach(requirement => this._checkSourceVersionedStructuredRefs({file, name, source, root: requirement, isOneItemContext}));
		if (root.excludes) this._checkSourceVersionedStructuredRefs({file, name, source, root: root.excludes, isOneItemContext});

		if (root.attachedSpells) {
			this._checkArrayItemsExist({file, name, source, arr: Renderer.item.getFlatAttachedSpells(root), prop: "attachedSpells", tag: "spell"});
		}

		if (root.classFeatures) {
			this._checkArrayDuplicates({file, name, source, arr: root.classFeatures, prop: "classFeatures", tag: "classFeature", propEntity: "classFeature"});
			this._checkArrayItemsExist({file, name, source, arr: root.classFeatures, prop: "classFeatures", tag: "classFeature", propEntity: "classFeature"});
		}

		if (root.optionalfeatures) {
			this._checkArrayDuplicates({file, name, source, arr: root.optionalfeatures, prop: "optionalfeatures", tag: "optfeature", propEntity: "optionalfeature"});
			this._checkArrayItemsExist({file, name, source, arr: root.optionalfeatures, prop: "optionalfeatures", tag: "optfeature", propEntity: "optionalfeature"});
		}

		if (root.items) {
			this._checkArrayDuplicates({file, name, source, arr: root.items, prop: "items", tag: "item"});
			this._checkArrayItemsExist({file, name, source, arr: root.items, prop: "items", tag: "item"});
		}

		if (root.packContents) {
			this._checkArrayDuplicates({file, name, source, arr: root.packContents, prop: "packContents", tag: "item"});
			this._checkArrayItemsExist({file, name, source, arr: root.packContents, prop: "packContents", tag: "item"});
		}

		if (root.containerCapacity && root.containerCapacity.item) {
			root.containerCapacity.item.forEach(itemToCount => {
				this._checkArrayItemsExist({file, name, source, arr: Object.keys(itemToCount), prop: "containerCapacity", tag: "item"});
			});
		}

		if (root.ammoType) {
			this._checkArrayItemsExist({file, name, source, arr: [root.ammoType], prop: "ammoType", tag: "item"});
		}

		if (root.baseItem) {
			const url = `${Renderer.tag.getPage("item")}#${UrlUtil.encodeForHash(root.baseItem.split("|"))}`
				.toLowerCase()
				.trim()
				.replace(/%5c/gi, "");

			if (!this._tagTestUrlLookup.hasUrl(url)) {
				this._addMessage(`Missing link: ${root.baseItem} in file ${file} (evaluates to "${url}")\n${this._tagTestUrlLookup.getLogPtSimilarUrls({url})}`);
			}
		}

		this._doCheckSeeAlso({entity: root, prop: "seeAlsoDeck", tag: "deck", file});
		this._doCheckSeeAlso({entity: root, prop: "seeAlsoVehicle", tag: "vehicle", file});

		if (root.reqAttuneTags) this._checkReqAttuneTags(file, root, name, source, "reqAttuneTags");
		if (root.reqAttuneAltTags) this._checkReqAttuneTags(file, root, name, source, "reqAttuneAltTags");

		if (root.mastery) {
			this._checkArrayDuplicates({file, name, source, arr: root.mastery, prop: "mastery", tag: "itemMastery"});
			this._checkArrayItemsExist({file, name, source, arr: root.mastery, prop: "mastery", tag: "itemMastery"});
		}

		if (root.lootTables) {
			this._checkArrayItemsExist({file, name, source, arr: root.lootTables, prop: "lootTables", tag: "table"});
		}
	}

	async _pDoTestEntity ({filePath, fileState, ent, prop, propPrefixed}) {
		const source = SourceUtil.getEntitySource(ent);
		const isOneItemContext = this._isOneItemContext({root: ent, source});

		this._checkRoot(filePath, ent, ent.name, source, {isOneItemContext});
		if (ent.inherits) {
			this._checkRoot(
				filePath,
				ent.inherits,
				`${ent.name} (inherits)`,
				source,
				{isOneItemContext: isOneItemContext || this._isOneItemContext({root: ent.inherits, source})},
			);
		}
	}
}
