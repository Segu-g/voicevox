import { ref, computed } from "vue";
import { defineStore, storeToRefs } from "pinia";
import { v4 as uuidv4 } from "uuid";
import { useStoreAsState } from "./store-helper";
import { useStore as useVuexStore } from "@/store";
import {
  ExperimentalSetting,
  Preset,
  PresetKey,
  Voice,
  VoiceId,
} from "@/type/preload";

/**
 * configを参照して割り当てるべきpresetKeyとそのPresetを適用すべきかどうかを返す
 *
 * generate: プロジェクト新規作成時、空のAudioItemを作成する場合
 * copy: 元となるAudioItemがある場合（＋ボタンで作成したとき）
 * changeVoice: ボイス切り替え時
 */
export function determineNextPresetKey(
  defaultPresetKeys: State["defaultPresetKeys"],
  experimentalSetting: ExperimentalSetting,
  inheritAudioInfo: boolean,
  voice: Voice,
  presetKeyCandidate: PresetKey | undefined,
  operation: "generate" | "copy" | "changeVoice"
): {
  nextPresetKey: PresetKey | undefined;
  shouldApplyPreset: boolean;
} {
  const defaultPresetKeyForCurrentVoice = defaultPresetKeys[VoiceId(voice)];

  switch (operation) {
    case "generate": {
      // 初回作成時
      return {
        nextPresetKey: defaultPresetKeyForCurrentVoice,
        shouldApplyPreset: experimentalSetting.enablePreset,
      };
    }
    case "copy": {
      // 元となるAudioItemがある場合
      if (inheritAudioInfo) {
        // パラメータ引継ぎがONならそのまま引き継ぐ
        return {
          nextPresetKey: presetKeyCandidate,
          shouldApplyPreset: false,
        };
      }

      // それ以外はデフォルトプリセットを割り当て、適用するかはプリセットのON/OFFに依存
      return {
        nextPresetKey: defaultPresetKeyForCurrentVoice,
        shouldApplyPreset: experimentalSetting.enablePreset,
      };
    }
    case "changeVoice": {
      // ボイス切り替え時
      if (experimentalSetting.shouldApplyDefaultPresetOnVoiceChanged) {
        // デフォルトプリセットを適用する
        return {
          nextPresetKey: defaultPresetKeyForCurrentVoice,
          shouldApplyPreset: true,
        };
      }

      const isDefaultPreset = Object.values(defaultPresetKeys).some(
        (key) => key === presetKeyCandidate
      );

      // 引き継ぎ元が他スタイルのデフォルトプリセットだった場合
      // 別キャラのデフォルトプリセットを引き継がないようにする
      // それ以外は指定そのまま
      return {
        nextPresetKey: isDefaultPreset
          ? defaultPresetKeyForCurrentVoice
          : presetKeyCandidate,
        shouldApplyPreset: false,
      };
    }
  }
}

type State = ReturnType<typeof usePresetState>;

const usePresetState = defineStore("preset/state", () => {
  const presetKeys = ref<PresetKey[]>([]);
  const presetItems = ref<Record<PresetKey, Preset>>({});
  const defaultPresetKeys = ref<Record<VoiceId, PresetKey>>({});
  return {
    presetKeys,
    presetItems,
    defaultPresetKeys,
  };
});

export const usePresetStore = defineStore("preset", () => {
  const { state, defMut, defAct } = useStoreAsState(usePresetState);
  const vuexStore = useVuexStore();

  const defaultPresetKeySets = computed(() => {
    return new Set(Object.values(state.defaultPresetKeys));
  });

  const setPresetItems = defMut(
    (state, { presetItems }: { presetItems: Record<PresetKey, Preset> }) => {
      state.presetItems = presetItems;
    }
  );

  const setPresetKeys = defMut(
    (state, { presetKeys }: { presetKeys: PresetKey[] }) => {
      state.presetKeys = presetKeys;
    }
  );

  const setDefaultPresetMap = defAct(
    async ({
      defaultPresetKeys,
    }: {
      defaultPresetKeys: Record<VoiceId, PresetKey>;
    }) => {
      window.electron.setSetting("defaultPresetKeys", defaultPresetKeys);
      setDefaultPresetMapMut.act({ defaultPresetKeys });
    }
  );

  const setDefaultPresetMapMut = defMut(
    (
      state,
      { defaultPresetKeys }: { defaultPresetKeys: Record<VoiceId, PresetKey> }
    ) => {
      state.defaultPresetKeys = defaultPresetKeys;
    }
  );

  const hydratePresetStore = defAct(async () => {
    const defaultPresetKeys = (await window.electron.getSetting(
      "defaultPresetKeys"
      // z.BRAND型のRecordはPartialになる仕様なのでasで型を変換
      // TODO: 将来的にzodのバージョンを上げてasを消す https://github.com/colinhacks/zod/pull/2097
    )) as Record<VoiceId, PresetKey>;

    setDefaultPresetMapMut.act({
      defaultPresetKeys,
    });

    const presetConfig = await window.electron.getSetting("presets");
    if (
      presetConfig === undefined ||
      presetConfig.items === undefined ||
      presetConfig.keys === undefined
    )
      return;
    setPresetItems.act({
      // z.BRAND型のRecordはPartialになる仕様なのでasで型を変換
      // TODO: 将来的にzodのバージョンを上げてasを消す https://github.com/colinhacks/zod/pull/2097
      presetItems: presetConfig.items as Record<PresetKey, Preset>,
    });
    setPresetKeys.act({
      presetKeys: presetConfig.keys,
    });
  });

  const savePresetOrder = defAct(
    async ({ presetKeys }: { presetKeys: PresetKey[] }) => {
      return savePresetConfig({
        presetItems: state.presetItems,
        presetKeys,
      });
    }
  );

  const savePresetConfig = defAct(
    async ({
      presetItems,
      presetKeys,
    }: {
      presetItems: Record<PresetKey, Preset>;
      presetKeys: PresetKey[];
    }) => {
      const result = await window.electron.setSetting("presets", {
        items: JSON.parse(JSON.stringify(presetItems)),
        keys: JSON.parse(JSON.stringify(presetKeys)),
      });
      setPresetItems.act({
        // z.BRAND型のRecordはPartialになる仕様なのでasで型を変換
        // TODO: 将来的にzodのバージョンを上げてasを消す https://github.com/colinhacks/zod/pull/2097
        presetItems: result.items as Record<PresetKey, Preset>,
      });
      setPresetKeys.act({ presetKeys: result.keys });
    }
  );

  const addPreset = defAct(async ({ presetData }: { presetData: Preset }) => {
    const newKey = PresetKey(uuidv4());
    const newPresetItems = {
      ...state.presetItems,
      [newKey]: presetData,
    };
    const newPresetKeys = [newKey, ...state.presetKeys];

    await savePresetConfig({
      presetItems: newPresetItems,
      presetKeys: newPresetKeys,
    });

    return newKey;
  });

  const createAllDefaultPreset = defAct(async () => {
    const voices = vuexStore.getters.GET_ALL_VOICES;

    for (const voice of voices) {
      const voiceId = VoiceId(voice);
      const defaultPresetKey = state.defaultPresetKeys[voiceId];

      if (state.presetKeys.includes(defaultPresetKey)) {
        continue;
      }

      const characterName = vuexStore.getters.VOICE_NAME(voice);

      const presetData: Preset = {
        name: `デフォルト：${characterName}`,
        speedScale: 1.0,
        pitchScale: 0.0,
        intonationScale: 1.0,
        volumeScale: 1.0,
        prePhonemeLength: 0.1,
        postPhonemeLength: 0.1,
      };
      const newPresetKey = await addPreset({ presetData });

      await setDefaultPresetMap({
        defaultPresetKeys: {
          ...state.defaultPresetKeys,
          [voiceId]: newPresetKey,
        },
      });
    }
  });

  const updatePreset = defAct(
    async ({
      presetKey,
      presetData,
    }: {
      presetData: Preset;
      presetKey: PresetKey;
    }) => {
      const newPresetItems = {
        ...state.presetItems,
        [presetKey]: presetData,
      };
      const newPresetKeys = state.presetKeys.includes(presetKey)
        ? [...state.presetKeys]
        : [presetKey, ...state.presetKeys];

      await savePresetConfig({
        presetItems: newPresetItems,
        presetKeys: newPresetKeys,
      });
    }
  );

  const deletePreset = defAct(
    async ({ presetKey }: { presetKey: PresetKey }) => {
      const newPresetKeys = state.presetKeys.filter((key) => key != presetKey);
      // Filter the `presetKey` properties from presetItems.
      const { [presetKey]: _, ...newPresetItems } = state.presetItems;

      await savePresetConfig({
        presetItems: newPresetItems,
        presetKeys: newPresetKeys,
      });
    }
  );

  return {
    ...storeToRefs(state),
    defaultPresetKeySets,
    setPresetItems,
    setPresetKeys,
    setDefaultPresetMap,
    setDefaultPresetMapMut,
    hydratePresetStore,
    savePresetOrder,
    savePresetConfig,
    addPreset,
    createAllDefaultPreset,
    updatePreset,
    deletePreset,
  };
});
