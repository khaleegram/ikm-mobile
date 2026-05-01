import { useAudioPlayer } from "@/hooks/use-audio-player";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import {
    ActivityIndicator,
    Keyboard,
    KeyboardEvent,
    Modal,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import KeyboardScreen from "@/components/layout/KeyboardScreen";
import { MarketSoundRow } from "@/components/market/market-sound-row";
import { MarketVideoSurface } from "@/components/market/market-video-surface";
import { showToast } from "@/components/toast";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { firestore } from "@/lib/firebase/config";
import { marketPostsApi } from "@/lib/api/market-posts";
import { useUploadProgress } from "@/lib/context/upload-progress";
import { scheduleNotification } from "@/lib/hooks/use-notifications";
import { marketSoundsApi } from "@/lib/api/market-sounds";
import {
    NIGERIA_LOCATION_OPTIONS,
    type NigeriaLocationOption,
} from "@/lib/constants/nigeria-locations";
import { useUser } from "@/lib/firebase/auth/use-user";
import {
    useMarketSound,
    useMarketSounds,
    useSavedMarketSounds,
    useUserSavedSoundIds,
} from "@/lib/firebase/firestore/market-sounds";
import { useTheme } from "@/lib/theme/theme-context";
import { canPostToMarketStreet } from "@/lib/utils/auth-helpers";
import { getLoginRoute } from "@/lib/utils/auth-routes";
import { haptics } from "@/lib/utils/haptics";
import {
    pickImage,
    pickMultipleImages,
    pickVideo,
} from "@/lib/utils/image-upload";
import {
    buildOriginalSoundTitle,
    buildUploadedSoundTitle,
} from "@/lib/utils/market-media";
import type { MarketSound } from "@/types";

const LIGHT_BROWN = "#A67C52";
const MAX_IMAGES = 20;
const HASHTAG_REGEX = /(^|\s)#([a-zA-Z0-9_]+)/g;

function extractHashtags(text: string): string[] {
  const found: string[] = [];
  HASHTAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = HASHTAG_REGEX.exec(text)) !== null) {
    const tag = String(match[2] || "")
      .trim()
      .toLowerCase();
    if (tag && !found.includes(tag)) found.push(tag);
    if (found.length >= 10) break;
  }
  return found;
}

function Chip({
  active,
  colors,
  label,
  onPress,
}: {
  active?: boolean;
  colors: {
    border: string;
    primary: string;
    text: string;
    textSecondary: string;
  };
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? `${colors.primary}18` : "transparent",
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? colors.primary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function normalizeCreatePostError(error: unknown): string {
  const raw = (error as any)?.message || "Unable to publish post.";
  const lower = String(raw).toLowerCase();
  if (lower.includes("photo")) return "Please add at least one photo.";
  if (lower.includes("video")) return "Please pick a video before publishing.";
  if (lower.includes("document picker"))
    return "Rebuild your dev build to use audio selection.";
  return String(raw);
}

export default function CreatePostScreen() {
  const { user } = useUser();
  const { colors } = useTheme();
  const { startUpload, setUploadProgress, finishUpload, failUpload } = useUploadProgress();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ soundId?: string }>();
  const initialSoundId = Array.isArray(params.soundId)
    ? params.soundId[0]
    : params.soundId;
  const { sound: preselectedSound } = useMarketSound(initialSoundId || null);
  const { sounds: allSounds, loading: soundsLoading } = useMarketSounds(
    null,
    120,
  );
  const { sounds: savedSounds, loading: savedSoundsLoading } =
    useSavedMarketSounds(user?.uid || null);
  const { soundIds: savedSoundIds } = useUserSavedSoundIds(user?.uid || null);

  const [postMode, setPostMode] = useState<"photo" | "video">("photo");
  const [images, setImages] = useState<string[]>([]);
  const [videoUri, setVideoUri] = useState("");
  const [coverImageUri, setCoverImageUri] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [isNegotiable, setIsNegotiable] = useState(false);
  const [location, setLocation] = useState({ state: "", city: "" });
  const [locationSearch, setLocationSearch] = useState("");
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [soundMode, setSoundMode] = useState<
    "original" | "existing" | "uploaded"
  >("existing");
  const [selectedSound, setSelectedSound] = useState<MarketSound | null>(null);
  const [uploadedSoundUri, setUploadedSoundUri] = useState("");
  const [uploadedSoundTitle, setUploadedSoundTitle] = useState("");
  const [soundPickerVisible, setSoundPickerVisible] = useState(false);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [previewingSoundId, setPreviewingSoundId] = useState<string | null>(
    null,
  );
  const [busySoundIds, setBusySoundIds] = useState<string[]>([]);
  const [keepOriginalAudio, setKeepOriginalAudio] = useState(true);
  const [soundStartMs, setSoundStartMs] = useState(0);
  const [soundVolume, setSoundVolume] = useState(0.9);
  const [originalAudioVolume, setOriginalAudioVolume] = useState(1);
  const [captionFocused, setCaptionFocused] = useState(false);
  const [trendingSuggestions, setTrendingSuggestions] = useState<string[]>([]);

  const captionRef = useRef<TextInput>(null);

  // Subscribe to top trending hashtags in real-time
  useEffect(() => {
    const q = query(
      collection(firestore, "trendingHashtags"),
      orderBy("count", "desc"),
      limit(30),
    );
    const unsub = onSnapshot(q, (snap) => {
      const tags: string[] = [];
      snap.forEach((d) => {
        const tag = d.data()?.tag;
        if (typeof tag === "string" && tag.trim()) tags.push(tag.trim().toLowerCase());
      });
      setTrendingSuggestions(tags);
    }, () => { /* silent fail — suggestions are non-critical */ });
    return unsub;
  }, []);

  // Update description; activeSuggestions derives partial-tag live from description
  const handleCaptionChange = useCallback((text: string) => {
    setDescription(text);
  }, []);

  const hashtags = useMemo(() => extractHashtags(description), [description]);

  // Filtered suggestions: match partial, exclude already-used tags
  const activeSuggestions = useMemo(() => {
    if (!captionFocused) return [];
    const lastWord = description.split(/\s/).pop() ?? "";
    if (!lastWord.startsWith("#")) return [];
    const partial = lastWord.slice(1).toLowerCase();
    const usedTags = new Set(hashtags);          // hashtags already in caption
    return trendingSuggestions
      .filter((t) => !usedTags.has(t) && (partial === "" || t.startsWith(partial)))
      .slice(0, 12);
  }, [captionFocused, description, trendingSuggestions, hashtags]);

  // Autocomplete: replace the partial #word at the end with the tapped tag
  const applyHashtagSuggestion = useCallback((tag: string) => {
    haptics.light();
    setDescription((prev) => {
      const words = prev.split(/(\s)/);          // keep whitespace tokens
      // Walk backwards to replace the last word that starts with #
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i].startsWith("#")) {
          words[i] = `#${tag}`;
          break;
        }
      }
      return words.join("") + " ";              // append space after completion
    });
  }, []);

  // Remove a confirmed tag by stripping it from the caption text
  const removeHashtagFromCaption = useCallback((tag: string) => {
    haptics.light();
    setDescription((prev) =>
      prev
        .replace(new RegExp(`(^|\\s)#${tag}(?=\\s|$)`, "gi"), " ")
        .replace(/\s{2,}/g, " ")
        .trimStart(),
    );
  }, []);

  // Keyboard event listeners — dismiss keyboard when tapping outside caption
  useEffect(() => {
    const onShow = (_e: KeyboardEvent) => {
      // keyboard visible — no-op, KeyboardScreen handles scroll
    };
    const onHide = () => {
      setCaptionFocused(false);
    };
    const showSub = Keyboard.addListener("keyboardDidShow", onShow);
    const hideSub = Keyboard.addListener("keyboardDidHide", onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!preselectedSound?.id) return;
    setPostMode("video");
    setSoundMode("existing");
    setSelectedSound(preselectedSound);
    setKeepOriginalAudio(false);
    setOriginalAudioVolume(0);
  }, [preselectedSound]);

  const locationLabel = useMemo(() => {
    if (!location.city && !location.state) return "";
    return [location.city, location.state].filter(Boolean).join(", ");
  }, [location.city, location.state]);
  const locationSuggestions = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    const pool = !q
      ? NIGERIA_LOCATION_OPTIONS
      : NIGERIA_LOCATION_OPTIONS.filter((option) =>
          option.label.toLowerCase().includes(q),
        );
    return pool.slice(0, 80);
  }, [locationSearch]);
  const displayedSounds = useMemo(() => {
    if (!showSavedOnly) return allSounds;
    const ids = new Set(savedSoundIds);
    return savedSounds.filter((sound) => sound.id && ids.has(sound.id));
  }, [allSounds, savedSoundIds, savedSounds, showSavedOnly]);
  const previewSound = useMemo(
    () => displayedSounds.find((item) => item.id === previewingSoundId) || null,
    [displayedSounds, previewingSoundId],
  );
  const previewPlayer = useAudioPlayer(previewSound?.sourceUri || null, {
    updateIntervalMs: 500,
  });

  useEffect(() => {
    previewPlayer.loop = true;
    previewPlayer.volume = 0.95;
    if (!previewSound?.sourceUri) {
      previewPlayer.pause();
      previewPlayer.currentTime = 0;
      return;
    }
    previewPlayer.currentTime = 0;
    previewPlayer.play();
  }, [previewPlayer, previewSound?.sourceUri]);

  const canPublish = useMemo(() => {
    if (publishing) return false;
    return postMode === "photo" ? images.length > 0 : Boolean(videoUri);
  }, [images.length, postMode, publishing, videoUri]);
  const videoPreviewSoundUri = useMemo(() => {
    if (soundMode === "existing") return selectedSound?.sourceUri || undefined;
    if (soundMode === "uploaded") return uploadedSoundUri || undefined;
    return undefined;
  }, [selectedSound?.sourceUri, soundMode, uploadedSoundUri]);
  const soundTitle = useMemo(() => {
    if (soundMode === "existing" && selectedSound) return selectedSound.title;
    if (soundMode === "uploaded" && uploadedSoundUri) {
      return (
        uploadedSoundTitle ||
        buildUploadedSoundTitle(
          uploadedSoundUri,
          user?.displayName || user?.email,
        )
      );
    }
    return buildOriginalSoundTitle(user?.displayName || user?.email);
  }, [
    selectedSound,
    soundMode,
    uploadedSoundTitle,
    uploadedSoundUri,
    user?.displayName,
    user?.email,
  ]);

  const pickImagesForPost = async () => {
    try {
      const picked = await pickMultipleImages(
        Math.max(1, MAX_IMAGES - images.length),
      );
      if (picked.length)
        setImages((prev) => [...prev, ...picked].slice(0, MAX_IMAGES));
    } catch (error: any) {
      showToast(error?.message || "Unable to pick photos.", "error");
    }
  };

  const pickVideoForPost = async () => {
    try {
      const picked = await pickVideo();
      if (!picked) return;
      setVideoUri(picked);
      if (soundMode === "original") {
        setKeepOriginalAudio(true);
        setOriginalAudioVolume(1);
      }
    } catch (error: any) {
      showToast(error?.message || "Unable to pick a video.", "error");
    }
  };

  const pickCover = async () => {
    try {
      const picked = await pickImage();
      if (picked) setCoverImageUri(picked);
    } catch (error: any) {
      showToast(error?.message || "Unable to pick a cover image.", "error");
    }
  };

  const pickAudioForSound = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if ((result as any)?.canceled) return;
      const asset = (result as any)?.assets?.[0];
      const pickedAudioUri = String(asset?.uri || "").trim();
      if (!pickedAudioUri) return;
      setSoundMode("uploaded");
      setUploadedSoundUri(pickedAudioUri);
      setUploadedSoundTitle(
        buildUploadedSoundTitle(
          pickedAudioUri,
          user?.displayName || user?.email,
        ),
      );
      setSelectedSound(null);
      showToast("Sound selected.", "success");
    } catch (error: any) {
      showToast(
        error?.message || "Unable to pick an audio file.",
        "error",
      );
    }
  };

  const selectExistingSound = (sound: MarketSound) => {
    setSoundMode("existing");
    setSelectedSound(sound);
    setUploadedSoundUri("");
    setUploadedSoundTitle("");
    setSoundPickerVisible(false);
    setPreviewingSoundId(null);
  };

  const toggleSaveSound = async (sound: MarketSound) => {
    if (!sound.id) return;
    try {
      setBusySoundIds((prev) => [...prev, sound.id!]);
      await marketSoundsApi.toggleSaveSound(
        sound.id,
        savedSoundIds.includes(sound.id),
      );
    } catch (error: any) {
      showToast(error?.message || "Unable to update saved sound.", "error");
    } finally {
      setBusySoundIds((prev) => prev.filter((id) => id !== sound.id));
    }
  };

  const resetForm = () => {
    setPostMode("photo");
    setImages([]);
    setVideoUri("");
    setCoverImageUri("");
    setDescription("");
    setPrice("");
    setIsNegotiable(false);
    setLocation({ state: "", city: "" });
    setLocationSearch("");
    setSoundMode("original");
    setSelectedSound(null);
    setUploadedSoundUri("");
    setUploadedSoundTitle("");
    setSoundPickerVisible(false);
    setShowSavedOnly(false);
    setPreviewingSoundId(null);
    setKeepOriginalAudio(true);
    setSoundStartMs(0);
    setSoundVolume(0.9);
    setOriginalAudioVolume(1);
  };

  const handlePublish = () => {
    if (!canPublish || publishing) return;
    haptics.medium();

    // Capture form state before reset
    const parsedPrice = price ? Number(price.replace(/[^0-9.]/g, "")) : undefined;
    const postData = {
      mediaType: postMode === "video" ? "video" as const : "image_gallery" as const,
      images: postMode === "photo" ? images : [],
      coverImageUri: postMode === "video" ? coverImageUri || undefined : undefined,
      videoUri: postMode === "video" ? videoUri || undefined : undefined,
      hashtags,
      description: description.trim() || undefined,
      price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
      isNegotiable: Number.isFinite(parsedPrice) ? isNegotiable : false,
      location: locationLabel ? location : undefined,
      contactMethod: "in-app" as const,
      soundSelection: postMode === "video"
        ? {
            mode: soundMode,
            existingSound: soundMode === "existing" ? selectedSound : undefined,
            uploadedAudioUri: soundMode === "uploaded" ? uploadedSoundUri || undefined : undefined,
            soundTitle: soundMode === "uploaded" ? uploadedSoundTitle || undefined : undefined,
            startMs: soundStartMs,
            soundVolume,
            originalAudioVolume,
            useOriginalVideoAudio: keepOriginalAudio,
          }
        : undefined,
    };
    const label = postMode === "video" ? "Uploading video…" : "Uploading post…";

    // Navigate away immediately — upload runs in the background
    resetForm();
    router.replace("/(market)" as any);
    startUpload(label);

    marketPostsApi.create(postData, setUploadProgress)
      .then(() => {
        finishUpload();
        haptics.success();
        scheduleNotification(
          "Post published! 🎉",
          "Your post is now live on Market Street.",
          { type: "general" },
        ).catch(() => {});
      })
      .catch((error) => {
        const msg = normalizeCreatePostError(error);
        failUpload(msg);
        haptics.error();
        scheduleNotification(
          "Upload failed",
          msg,
          { type: "general" },
        ).catch(() => {});
      });
  };

  // Derived: no media picked yet
  const hasNoMedia = images.length === 0 && !videoUri;

  if (!user || !canPostToMarketStreet(user)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <IconSymbol name="person.crop.circle.badge.exclamationmark" size={48} color={LIGHT_BROWN} />
        <Text style={[styles.guestTitle, { color: colors.text }]}>Sign in to post</Text>
        <TouchableOpacity style={[styles.publishBtn, { backgroundColor: LIGHT_BROWN }]} onPress={() => router.push(getLoginRoute() as any)}>
          <Text style={styles.publishBtnText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isDark = colors.background === "#0a0804" || colors.background < "#888";

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>

      {/* ── Header island ────────────────────────────────────────── */}
      <View style={[styles.headerIsland, { paddingTop: insets.top + 6 }]}>
        <View style={[styles.headerPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.headerClose} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <IconSymbol name="xmark" size={15} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>New Post</Text>
          <TouchableOpacity
            disabled={!canPublish}
            onPress={handlePublish}
            style={[styles.publishBtn, { backgroundColor: canPublish ? LIGHT_BROWN : `${LIGHT_BROWN}44` }]}
          >
            {publishing
              ? <ActivityIndicator size="small" color="#FFF" />
              : <Text style={styles.publishBtnText}>Share</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardScreen
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={28}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
      >

        {/* ── Media zone ───────────────────────────────────────────── */}
        {hasNoMedia ? (
          /* Immersive pick zone */
          <View style={[styles.pickZone, { backgroundColor: isDark ? `${LIGHT_BROWN}10` : `${LIGHT_BROWN}08`, borderColor: `${LIGHT_BROWN}30` }]}>
            {/* Photos side */}
            <TouchableOpacity
              style={styles.pickHalf}
              activeOpacity={0.7}
              onPress={async () => { setPostMode("photo"); await pickImagesForPost(); }}
            >
              <View style={[styles.pickIconRing, { backgroundColor: `${LIGHT_BROWN}20`, borderColor: `${LIGHT_BROWN}35` }]}>
                <IconSymbol name="photo.stack.fill" size={30} color={LIGHT_BROWN} />
              </View>
              <Text style={[styles.pickLabel, { color: colors.text }]}>Photos</Text>
              <Text style={[styles.pickHint, { color: colors.textSecondary }]}>Gallery</Text>
            </TouchableOpacity>

            {/* OR divider */}
            <View style={styles.pickDivider}>
              <View style={[styles.pickDividerLine, { backgroundColor: `${LIGHT_BROWN}25` }]} />
              <Text style={[styles.pickDividerOr, { color: `${LIGHT_BROWN}99`, backgroundColor: isDark ? `${LIGHT_BROWN}10` : `${LIGHT_BROWN}08` }]}>or</Text>
              <View style={[styles.pickDividerLine, { backgroundColor: `${LIGHT_BROWN}25` }]} />
            </View>

            {/* Video side */}
            <TouchableOpacity
              style={styles.pickHalf}
              activeOpacity={0.7}
              onPress={async () => { setPostMode("video"); await pickVideoForPost(); }}
            >
              <View style={[styles.pickIconRing, { backgroundColor: `${LIGHT_BROWN}20`, borderColor: `${LIGHT_BROWN}35` }]}>
                <IconSymbol name="video.fill" size={30} color={LIGHT_BROWN} />
              </View>
              <Text style={[styles.pickLabel, { color: colors.text }]}>Video</Text>
              <Text style={[styles.pickHint, { color: colors.textSecondary }]}>Camera roll</Text>
            </TouchableOpacity>
          </View>
        ) : postMode === "photo" ? (
          /* Photos preview card */
          <View style={[styles.mediaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Main preview with count badge */}
            <View>
              <Image source={{ uri: images[0] }} style={styles.mediaPreview} contentFit="cover" />
              <View style={styles.previewCountBadge}>
                <IconSymbol name="photo.stack.fill" size={11} color="#FFF" />
                <Text style={styles.previewCountText}>{images.length}</Text>
              </View>
              <TouchableOpacity style={styles.previewClearBtn} onPress={() => setImages([])}>
                <IconSymbol name="xmark" size={12} color="#FFF" />
              </TouchableOpacity>
            </View>
            {/* Thumbnails strip */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
              {images.map((uri, index) => (
                <TouchableOpacity
                  key={`${uri}-${index}`}
                  style={[styles.thumbWrap, index === 0 && { borderColor: LIGHT_BROWN, borderWidth: 2 }]}
                  onPress={() => setImages([images[index], ...images.filter((_, i) => i !== index)])}
                >
                  <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
                  <TouchableOpacity
                    style={styles.thumbRemove}
                    onPress={() => {
                      const next = images.filter((_, i) => i !== index);
                      setImages(next);
                    }}
                  >
                    <IconSymbol name="xmark" size={9} color="#FFF" />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
              {images.length < MAX_IMAGES && (
                <TouchableOpacity
                  style={[styles.addThumb, { backgroundColor: colors.backgroundSecondary, borderColor: `${LIGHT_BROWN}40` }]}
                  onPress={pickImagesForPost}
                >
                  <IconSymbol name="plus" size={22} color={LIGHT_BROWN} />
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        ) : (
          /* Video preview card */
          <View style={[styles.mediaCard, { backgroundColor: "#000", borderColor: colors.border }]}>
            {videoUri ? (
              <View style={styles.videoWrap}>
                <MarketVideoSurface
                  active
                  videoUri={videoUri}
                  externalSoundUri={videoPreviewSoundUri}
                  externalSoundVolume={soundVolume}
                  originalAudioVolume={originalAudioVolume}
                  soundStartMs={soundStartMs}
                  useOriginalVideoAudio={keepOriginalAudio}
                />
                {/* Overlay controls */}
                <View style={styles.videoOverlay}>
                  <TouchableOpacity style={styles.videoOverlayBtn} onPress={pickVideoForPost}>
                    <IconSymbol name="arrow.clockwise" size={14} color="#FFF" />
                    <Text style={styles.videoOverlayText}>Change</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.videoOverlayBtn, { backgroundColor: "rgba(200,60,60,0.75)" }]} onPress={() => setVideoUri("")}>
                    <IconSymbol name="trash.fill" size={14} color="#FFF" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {/* Cover image row */}
            <TouchableOpacity onPress={pickCover} style={[styles.coverBtn, { borderColor: colors.border, backgroundColor: colors.card }]}>
              {coverImageUri
                ? <Image source={{ uri: coverImageUri }} style={styles.coverThumb} contentFit="cover" />
                : <View style={[styles.coverThumbEmpty, { backgroundColor: `${LIGHT_BROWN}15` }]}>
                    <IconSymbol name="photo.badge.plus" size={16} color={LIGHT_BROWN} />
                  </View>}
              <Text style={[styles.coverBtnText, { color: colors.text }]}>{coverImageUri ? "Change thumbnail" : "Add thumbnail"}</Text>
              <IconSymbol name="chevron.right" size={13} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Details card ─────────────────────────────────────────── */}
        <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Caption section */}
          <View style={[styles.captionSection, { backgroundColor: isDark ? `${LIGHT_BROWN}07` : `${LIGHT_BROWN}05` }]}>
            <TextInput
              ref={captionRef}
              value={description}
              onChangeText={handleCaptionChange}
              onFocus={() => setCaptionFocused(true)}
              onBlur={() => setCaptionFocused(false)}
              placeholder="Write a caption… add #hashtags inline"
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={500}
              blurOnSubmit={false}
              style={[styles.captionInput, { color: colors.text }, captionFocused && styles.captionInputFocused]}
            />
            <View style={styles.captionFooter}>
              {/* Confirmed hashtag chips */}
              {hashtags.length > 0 && (
                <View style={styles.tagsWrap}>
                  {hashtags.map((tag) => (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.tagChip, { backgroundColor: `${LIGHT_BROWN}18`, borderColor: `${LIGHT_BROWN}35` }]}
                      onPress={() => removeHashtagFromCaption(tag)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.tagChipText, { color: LIGHT_BROWN }]}>#{tag}</Text>
                      <IconSymbol name="xmark" size={9} color={`${LIGHT_BROWN}BB`} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={[styles.charCount, { color: colors.textSecondary }]}>{description.length}/500</Text>
            </View>
          </View>

          {/* Trending hashtag suggestions */}
          {activeSuggestions.length > 0 && (
            <View style={[styles.suggestionsWrap, { borderTopColor: colors.border }]}>
              <Text style={[styles.suggestionsLabel, { color: LIGHT_BROWN }]}>TRENDING</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.suggestionsRow}
                keyboardShouldPersistTaps="always"
              >
                {activeSuggestions.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.suggestionChip, { backgroundColor: `${LIGHT_BROWN}15`, borderColor: `${LIGHT_BROWN}40` }]}
                    onPress={() => applyHashtagSuggestion(tag)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.suggestionChipText, { color: LIGHT_BROWN }]}>#{tag}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Pricing row */}
          <View style={[styles.sectionHeader, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: LIGHT_BROWN }]}>PRICING</Text>
          </View>
          <View style={styles.formRow}>
            <View style={[styles.rowIconWrap, { backgroundColor: `${LIGHT_BROWN}15` }]}>
              <IconSymbol name="tag.fill" size={14} color={LIGHT_BROWN} />
            </View>
            <Text style={[styles.rowPrefix, { color: colors.textSecondary }]}>₦</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="Set a price (optional)"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              style={[styles.rowInput, { color: colors.text }]}
            />
            <View style={styles.rowRight}>
              <Text style={[styles.rowRightLabel, { color: colors.textSecondary }]}>Negotiable</Text>
              <Switch
                value={isNegotiable}
                onValueChange={setIsNegotiable}
                thumbColor="#FFF"
                trackColor={{ false: colors.border, true: LIGHT_BROWN }}
              />
            </View>
          </View>

          {/* Location row */}
          <View style={[styles.sectionHeader, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: LIGHT_BROWN }]}>LOCATION</Text>
          </View>
          <TouchableOpacity style={styles.formRow} onPress={() => setLocationPickerVisible(true)}>
            <View style={[styles.rowIconWrap, { backgroundColor: `${LIGHT_BROWN}15` }]}>
              <IconSymbol name="location.fill" size={14} color={LIGHT_BROWN} />
            </View>
            <Text style={[styles.rowValue, { color: locationLabel ? colors.text : colors.textSecondary, flex: 1 }]} numberOfLines={1}>
              {locationLabel || "Add location (optional)"}
            </Text>
            {locationLabel
              ? <TouchableOpacity onPress={() => setLocation({ state: "", city: "" })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <IconSymbol name="xmark.circle.fill" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              : <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} />}
          </TouchableOpacity>

          {/* Sound section — video only */}
          {postMode === "video" && (
            <>
              <View style={[styles.sectionHeader, { borderTopColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: LIGHT_BROWN }]}>SOUND</Text>
              </View>
              <TouchableOpacity style={styles.formRow} onPress={() => setSoundPickerVisible(true)}>
                <View style={[styles.rowIconWrap, { backgroundColor: `${LIGHT_BROWN}15` }]}>
                  <IconSymbol name="music.note" size={14} color={LIGHT_BROWN} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowValue, { color: colors.text }]} numberOfLines={1}>{soundTitle}</Text>
                  <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                    {soundMode === "existing" ? "Library sound" : soundMode === "uploaded" ? "Your upload" : "Original audio"}
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <TouchableOpacity style={styles.formRow} onPress={pickAudioForSound}>
                <View style={[styles.rowIconWrap, { backgroundColor: `${LIGHT_BROWN}15` }]}>
                  <IconSymbol name="arrow.up.circle.fill" size={14} color={LIGHT_BROWN} />
                </View>
                <Text style={[styles.rowValue, { color: colors.text }]}>Upload your own sound</Text>
              </TouchableOpacity>
              {soundMode === "uploaded" && uploadedSoundUri ? (
                <TextInput
                  value={uploadedSoundTitle}
                  onChangeText={setUploadedSoundTitle}
                  placeholder="Sound title"
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.soundTitleInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
                />
              ) : null}
            </>
          )}
        </View>
      </KeyboardScreen>

      {/* ── Location modal ───────────────────────────────────────── */}
      <Modal visible={locationPickerVisible} transparent animationType="slide" onRequestClose={() => setLocationPickerVisible(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Location</Text>
              <TouchableOpacity onPress={() => setLocationPickerVisible(false)}>
                <IconSymbol name="xmark" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={locationSearch}
              onChangeText={setLocationSearch}
              placeholder="Search state or city…"
              placeholderTextColor={colors.textSecondary}
              style={[styles.sheetSearch, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
            />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {locationSuggestions.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                  onPress={() => { setLocation({ state: option.state, city: option.city }); setLocationPickerVisible(false); setLocationSearch(""); }}
                >
                  <Text style={[styles.sheetRowTitle, { color: colors.text }]}>{option.city}</Text>
                  <Text style={[styles.sheetRowSub, { color: colors.textSecondary }]}>{option.state}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Sound library modal ──────────────────────────────────── */}
      <Modal
        visible={soundPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { setSoundPickerVisible(false); setPreviewingSoundId(null); }}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: "85%" }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Sound Library</Text>
              <TouchableOpacity onPress={() => { setSoundPickerVisible(false); setPreviewingSoundId(null); }}>
                <IconSymbol name="xmark" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.chipsRow}>
              <Chip active={!showSavedOnly} colors={colors} label="All" onPress={() => setShowSavedOnly(false)} />
              <Chip active={showSavedOnly} colors={colors} label="Saved" onPress={() => setShowSavedOnly(true)} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
              {soundsLoading || savedSoundsLoading
                ? <ActivityIndicator size="small" color={LIGHT_BROWN} style={{ marginTop: 24 }} />
                : displayedSounds.length === 0
                  ? <Text style={[styles.sheetRowSub, { color: colors.textSecondary, textAlign: "center", marginTop: 24 }]}>No sounds yet.</Text>
                  : displayedSounds.map((sound) => (
                      <MarketSoundRow
                        key={sound.id || sound.title}
                        colors={colors}
                        sound={sound}
                        selected={selectedSound?.id === sound.id}
                        isPreviewing={previewingSoundId === sound.id}
                        isSaved={Boolean(sound.id && savedSoundIds.includes(sound.id))}
                        togglingSave={Boolean(sound.id && busySoundIds.includes(sound.id))}
                        onPreview={() => setPreviewingSoundId((c) => c === sound.id ? null : sound.id || null)}
                        onOpen={() => selectExistingSound(sound)}
                        onToggleSave={() => toggleSaveSound(sound)}
                      />
                    ))
              }
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // Guest screen
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 28, gap: 16 },
  guestTitle: { fontSize: 20, fontWeight: "800", textAlign: "center" },

  // Floating island header
  headerIsland: { paddingHorizontal: 14, paddingBottom: 10, zIndex: 10 },
  headerPill: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 28, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 6,
  },
  headerClose: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 15, fontWeight: "800", flex: 1, textAlign: "center" },
  publishBtn: { minWidth: 84, minHeight: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  publishBtnText: { color: "#FFF", fontWeight: "800", fontSize: 14 },

  // Content scroll
  content: { paddingHorizontal: 14, paddingTop: 6, gap: 12 },

  // ── Empty pick zone ──────────────────────────────────────────
  pickZone: {
    flexDirection: "row", borderRadius: 24, borderWidth: 1,
    borderStyle: "dashed", minHeight: 200, overflow: "hidden",
  },
  pickHalf: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 36, paddingHorizontal: 8 },
  pickIconRing: {
    width: 66, height: 66, borderRadius: 33, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  pickLabel: { fontSize: 16, fontWeight: "800" },
  pickHint: { fontSize: 12 },
  pickDivider: { width: 28, alignItems: "center", justifyContent: "center" },
  pickDividerLine: { flex: 1, width: 1 },
  pickDividerOr: { fontSize: 11, fontWeight: "700", paddingVertical: 6, fontStyle: "italic" },

  // ── Media card (photos / video) ─────────────────────────────
  mediaCard: { borderRadius: 22, borderWidth: 1, overflow: "hidden" },
  mediaPreview: { width: "100%", height: 300 },
  previewCountBadge: {
    position: "absolute", top: 10, left: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  previewCountText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
  previewClearBtn: {
    position: "absolute", top: 10, right: 10,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center",
  },
  thumbRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  thumbWrap: { width: 66, height: 66, borderRadius: 13, overflow: "hidden", borderWidth: 0 },
  thumb: { width: "100%", height: "100%" },
  thumbRemove: {
    position: "absolute", top: 3, right: 3, width: 18, height: 18,
    borderRadius: 9, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center",
  },
  addThumb: { width: 66, height: 66, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  // Video
  videoWrap: { width: "100%", height: 340, backgroundColor: "#000" },
  videoOverlay: {
    position: "absolute", bottom: 10, right: 10,
    flexDirection: "row", gap: 8,
  },
  videoOverlayBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  videoOverlayText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
  coverBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  coverThumb: { width: 42, height: 42, borderRadius: 10 },
  coverThumbEmpty: { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  coverBtnText: { flex: 1, fontSize: 14, fontWeight: "600" },

  // ── Details form card ────────────────────────────────────────
  formCard: { borderRadius: 22, borderWidth: 1, overflow: "hidden" },

  captionSection: { paddingBottom: 4 },
  captionInput: {
    minHeight: 110, paddingHorizontal: 16, paddingTop: 16,
    fontSize: 15, lineHeight: 22, textAlignVertical: "top",
  },
  captionInputFocused: { minHeight: 140 },
  captionFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 10, flexWrap: "wrap", gap: 4 },
  charCount: { fontSize: 11, alignSelf: "flex-end" },

  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  tagChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  tagChipText: { fontSize: 12, fontWeight: "700" },

  // Trending suggestions
  suggestionsWrap: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  suggestionsLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  suggestionsRow: { gap: 6, paddingVertical: 2 },
  suggestionChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  suggestionChipText: { fontSize: 12, fontWeight: "700" },

  // Section labels
  sectionHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, borderTopWidth: StyleSheet.hairlineWidth },
  sectionLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },

  divider: { height: StyleSheet.hairlineWidth },
  formRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  rowIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowPrefix: { fontSize: 15, fontWeight: "700" },
  rowInput: { flex: 1, fontSize: 14, minHeight: 28 },
  rowValue: { fontSize: 14, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowRightLabel: { fontSize: 11, fontWeight: "600" },
  soundTitleInput: { marginHorizontal: 14, marginBottom: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { minHeight: 34, borderRadius: 17, borderWidth: 1, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 12, fontWeight: "700" },

  // Bottom sheets
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, gap: 12, maxHeight: "80%",
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.3)", alignSelf: "center", marginBottom: 6 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontWeight: "800" },
  sheetSearch: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  sheetRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetRowTitle: { fontSize: 15, fontWeight: "700" },
  sheetRowSub: { fontSize: 12, marginTop: 2 },
});
