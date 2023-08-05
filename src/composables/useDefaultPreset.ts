import { computed } from "vue";
import { usePresetStore } from "@/pinia-stores/preset";
import { PresetKey, Voice, VoiceId } from "@/type/preload";

export const useDefaultPreset = () => {
  const presetStore = usePresetStore();

  const defaultPresetKeys = computed(() => presetStore.defaultPresetKeys);

  const getDefaultPresetKeyForVoice = (voice: Voice): string => {
    const voiceId = VoiceId(voice);
    return defaultPresetKeys.value[voiceId];
  };

  const isDefaultPresetKey = (presetKey: PresetKey): boolean => {
    return presetStore.defaultPresetKeySets.has(presetKey);
  };

  return {
    getDefaultPresetKeyForVoice,
    isDefaultPresetKey,
  };
};
