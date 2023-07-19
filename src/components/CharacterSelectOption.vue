<template>
  <q-item
    :key="characterIndex"
    class="q-pa-none"
    :class="selected && 'selected-character-item'"
  >
    <q-btn-group flat class="col full-width">
      <q-btn
        v-close-popup
        flat
        no-caps
        class="col-grow"
        @click="onSelectSpeaker(characterInfo.metas.speakerUuid)"
        @mouseover="reassignSubMenuOpen(-1)"
        @mouseleave="reassignSubMenuOpen.cancel()"
      >
        <q-avatar rounded size="2rem" class="q-mr-md">
          <q-img
            v-if="characterInfo"
            no-spinner
            no-transition
            :ratio="1"
            :src="getDefaultStyle(characterInfo.metas.speakerUuid).iconPath"
          />
          <q-avatar
            v-if="showEngineInfo && characterInfo.metas.styles.length < 2"
            class="engine-icon"
            rounded
          >
            <img
              :src="
                engineIcons[
                  getDefaultStyle(characterInfo.metas.speakerUuid).engineId
                ]
              "
            />
          </q-avatar>
        </q-avatar>
        <div>{{ characterInfo.metas.speakerName }}</div>
      </q-btn>
      <!-- スタイルが2つ以上あるものだけ、スタイル選択ボタンを表示する-->
      <template v-if="characterInfo.metas.styles.length >= 2">
        <q-separator vertical />

        <div
          class="flex items-center q-px-sm q-py-none cursor-pointer"
          :class="subMenuExpanded && 'selected-background'"
          role="application"
          :aria-label="`${characterInfo.metas.speakerName}のスタイル、マウスオーバーするか、右矢印キーを押してスタイル選択を表示できます`"
          tabindex="0"
          @mouseover="reassignSubMenuOpen(characterIndex)"
          @mouseleave="reassignSubMenuOpen.cancel()"
          @keyup.right="reassignSubMenuOpen(characterIndex)"
        >
          <q-icon name="keyboard_arrow_right" color="grey-6" size="sm" />
          <q-menu
            :value="subMenuExpanded"
            no-parent-event
            anchor="top end"
            self="top start"
            transition-show="none"
            transition-hide="none"
            class="character-menu"
          >
            <q-list style="min-width: max-content">
              <q-item
                v-for="(style, styleIndex) in characterInfo.metas.styles"
                :key="styleIndex"
                v-close-popup
                clickable
                active-class="selected-style-item"
                :active="
                  selectedVoice != undefined &&
                  style.styleId === selectedVoice.styleId
                "
                :aria-pressed="
                  selectedVoice != undefined &&
                  style.styleId === selectedVoice.styleId
                "
                role="button"
                @click="
                  $emit('update:selectedVoice', {
                    engineId: style.engineId,
                    speakerId: characterInfo.metas.speakerUuid,
                    styleId: style.styleId,
                  })
                "
              >
                <q-avatar rounded size="2rem" class="q-mr-md">
                  <q-img
                    no-spinner
                    no-transition
                    :ratio="1"
                    :src="characterInfo.metas.styles[styleIndex].iconPath"
                  />
                  <q-avatar v-if="showEngineInfo" rounded class="engine-icon">
                    <img
                      :src="
                        engineIcons[
                          characterInfo.metas.styles[styleIndex].engineId
                        ]
                      "
                    />
                  </q-avatar>
                </q-avatar>
                <q-item-section v-if="style.styleName"
                  >{{ characterInfo.metas.speakerName }} ({{
                    style.styleName
                  }})</q-item-section
                >
                <q-item-section v-else>{{
                  characterInfo.metas.speakerName
                }}</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </div>
      </template>
    </q-btn-group>
  </q-item>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "@/store";
import { CharacterInfo, SpeakerId, Voice } from "@/type/preload";


const props = withDefaults(defineProps<{
    characterInfos: CharacterInfo[];
    characterInfo: CharacterInfo;
    selectedVoice: Voice | undefined;
    showEngineInfo?: boolean;
    subMenuExpanded?: boolean;
}>(), {
    showEngineInfo: false,
    subMenuExpanded: false,
});

const emit = defineEmits<{"update:selectedVoice": (selectedVoice: Voice | undefined) => void}>();

const store = useStore();

const getDefaultStyle = (speakerUuid: SpeakerId) => {
  // FIXME: 同一キャラが複数エンジンにまたがっているとき、順番が先のエンジンが必ず選択される
  const characterInfo = props.characterInfos.find(
    (info) => info.metas.speakerUuid === speakerUuid
  );
  const defaultStyleId = store.state.defaultStyleIds.find(
    (x) => x.speakerUuid === speakerUuid
  )?.defaultStyleId;

  const defaultStyle =
    characterInfo?.metas.styles.find(
      (style) => style.styleId === defaultStyleId
    ) ?? characterInfo?.metas.styles[0]; // デフォルトのスタイルIDが見つからない場合stylesの先頭を選択する

  if (defaultStyle == undefined) throw new Error("defaultStyle == undefined");

  return defaultStyle;
};


const selected = computed(() => props)
</script>
