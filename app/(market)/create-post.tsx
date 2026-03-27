import { useAudioPlayer } from "@/hooks/use-audio-player";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import {
    ActivityIndicator,
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
import { marketPostsApi } from "@/lib/api/market-posts";
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
    extractFileStem,
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

  useEffect(() => {
    if (!preselectedSound?.id) return;
    setPostMode("video");
    setSoundMode("existing");
    setSelectedSound(preselectedSound);
    setKeepOriginalAudio(false);
    setOriginalAudioVolume(0);
  }, [preselectedSound]);

  const hashtags = useMemo(() => extractHashtags(description), [description]);
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

  const handlePublish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    haptics.medium();
    try {
      const parsedPrice = price
        ? Number(price.replace(/[^0-9.]/g, ""))
        : undefined;
      await marketPostsApi.create({
        mediaType: postMode === "video" ? "video" : "image_gallery",
        images: postMode === "photo" ? images : [],
        coverImageUri:
          postMode === "video" ? coverImageUri || undefined : undefined,
        videoUri: postMode === "video" ? videoUri || undefined : undefined,
        hashtags,
        description: description.trim() || undefined,
        price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
        isNegotiable: Number.isFinite(parsedPrice) ? isNegotiable : false,
        location: locationLabel ? location : undefined,
        contactMethod: "in-app",
        soundSelection:
          postMode === "video"
            ? {
                mode: soundMode,
                existingSound:
                  soundMode === "existing" ? selectedSound : undefined,
                uploadedAudioUri:
                  soundMode === "uploaded"
                    ? uploadedSoundUri || undefined
                    : undefined,
                soundTitle:
                  soundMode === "uploaded"
                    ? uploadedSoundTitle || undefined
                    : undefined,
                startMs: soundStartMs,
                soundVolume,
                originalAudioVolume,
                useOriginalVideoAudio: keepOriginalAudio,
              }
            : undefined,
      });
      haptics.success();
      showToast(
        postMode === "video" ? "Video post published." : "Post published.",
        "success",
      );
      resetForm();
      router.replace("/(market)" as any);
    } catch (error) {
      haptics.error();
      showToast(normalizeCreatePostError(error), "error");
    } finally {
      setPublishing(false);
    }
  };

  if (!user || !canPostToMarketStreet(user)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>
          Sign in to create a post
        </Text>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: LIGHT_BROWN }]}
          onPress={() => router.push(getLoginRoute() as any)}
        >
          <Text style={styles.primaryButtonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.back()}
        >
          <IconSymbol name="xmark" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Create Post
        </Text>
        <TouchableOpacity
          disabled={!canPublish}
          onPress={handlePublish}
          style={[
            styles.publishButton,
            {
              backgroundColor: canPublish
                ? LIGHT_BROWN
                : colors.backgroundSecondary,
            },
          ]}
        >
          {publishing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.publishButtonText}>Publish</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardScreen
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={28}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 90 },
        ]}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Post Format
          </Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[
                styles.segment,
                {
                  backgroundColor:
                    postMode === "photo"
                      ? LIGHT_BROWN
                      : colors.backgroundSecondary,
                },
              ]}
              onPress={() => setPostMode("photo")}
            >
              <Text style={styles.segmentText}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segment,
                {
                  backgroundColor:
                    postMode === "video"
                      ? LIGHT_BROWN
                      : colors.backgroundSecondary,
                },
              ]}
              onPress={() => setPostMode("video")}
            >
              <Text style={styles.segmentText}>Video + Sound</Text>
            </TouchableOpacity>
          </View>
        </View>

        {postMode === "photo" ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Photos
            </Text>
            {images.length === 0 ? (
              <TouchableOpacity
                style={[
                  styles.emptyBox,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.border,
                  },
                ]}
                onPress={pickImagesForPost}
              >
                <IconSymbol name="photo.fill" size={28} color={LIGHT_BROWN} />
                <Text style={[styles.emptyText, { color: colors.text }]}>
                  Add Photos
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <Image
                  source={{ uri: images[0] }}
                  style={styles.preview}
                  contentFit="cover"
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.thumbRow}
                >
                  {images.map((uri, index) => (
                    <View key={`${uri}-${index}`} style={styles.thumbWrap}>
                      <Image
                        source={{ uri }}
                        style={styles.thumb}
                        contentFit="cover"
                      />
                      <TouchableOpacity
                        style={styles.thumbRemove}
                        onPress={() =>
                          setImages((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <IconSymbol name="xmark" size={10} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {images.length < MAX_IMAGES ? (
                    <TouchableOpacity
                      style={[
                        styles.addThumb,
                        {
                          backgroundColor: colors.backgroundSecondary,
                          borderColor: colors.border,
                        },
                      ]}
                      onPress={pickImagesForPost}
                    >
                      <IconSymbol name="plus" size={18} color={LIGHT_BROWN} />
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>
              </>
            )}
          </View>
        ) : (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Video
              </Text>
              {!videoUri ? (
                <TouchableOpacity
                  style={[
                    styles.emptyBox,
                    {
                      backgroundColor: colors.backgroundSecondary,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={pickVideoForPost}
                >
                  <IconSymbol
                    name="play.rectangle.fill"
                    size={28}
                    color={LIGHT_BROWN}
                  />
                  <Text style={[styles.emptyText, { color: colors.text }]}>
                    Pick Video
                  </Text>
                </TouchableOpacity>
              ) : (
                <>
                  <View style={styles.videoBox}>
                    <MarketVideoSurface
                      active={true}
                      videoUri={videoUri}
                      externalSoundUri={videoPreviewSoundUri}
                      externalSoundVolume={soundVolume}
                      originalAudioVolume={originalAudioVolume}
                      soundStartMs={soundStartMs}
                      useOriginalVideoAudio={keepOriginalAudio}
                    />
                  </View>
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={[
                        styles.secondaryButton,
                        { backgroundColor: colors.backgroundSecondary },
                      ]}
                      onPress={pickVideoForPost}
                    >
                      <Text
                        style={[
                          styles.secondaryButtonText,
                          { color: colors.text },
                        ]}
                      >
                        Change Video
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.secondaryButton,
                        { backgroundColor: colors.backgroundSecondary },
                      ]}
                      onPress={() => setVideoUri("")}
                    >
                      <Text
                        style={[
                          styles.secondaryButtonText,
                          { color: colors.text },
                        ]}
                      >
                        Remove
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  { backgroundColor: colors.backgroundSecondary },
                ]}
                onPress={pickCover}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: colors.text }]}
                >
                  {coverImageUri ? "Change Cover" : "Add Cover"}
                </Text>
              </TouchableOpacity>
              {coverImageUri ? (
                <Image
                  source={{ uri: coverImageUri }}
                  style={styles.cover}
                  contentFit="cover"
                />
              ) : null}
            </View>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.inlineHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Sound
                </Text>
                <TouchableOpacity
                  style={[
                    styles.smallButton,
                    { backgroundColor: colors.backgroundSecondary },
                  ]}
                  onPress={() => setSoundPickerVisible(true)}
                >
                  <Text
                    style={[styles.smallButtonText, { color: colors.text }]}
                  >
                    Browse
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[
                    styles.mode,
                    {
                      borderColor:
                        soundMode === "original" ? LIGHT_BROWN : colors.border,
                    },
                  ]}
                  onPress={() => setSoundMode("original")}
                >
                  <Text
                    style={[
                      styles.modeText,
                      {
                        color:
                          soundMode === "original"
                            ? LIGHT_BROWN
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    Original
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.mode,
                    {
                      borderColor:
                        soundMode === "existing" ? LIGHT_BROWN : colors.border,
                    },
                  ]}
                  onPress={() => setSoundPickerVisible(true)}
                >
                  <Text
                    style={[
                      styles.modeText,
                      {
                        color:
                          soundMode === "existing"
                            ? LIGHT_BROWN
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    Existing
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.mode,
                    {
                      borderColor:
                        soundMode === "uploaded" ? LIGHT_BROWN : colors.border,
                    },
                  ]}
                  onPress={pickAudioForSound}
                >
                  <Text
                    style={[
                      styles.modeText,
                      {
                        color:
                          soundMode === "uploaded"
                            ? LIGHT_BROWN
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    Upload
                  </Text>
                </TouchableOpacity>
              </View>
              <View
                style={[
                  styles.soundCard,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.soundTitle, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {soundTitle}
                </Text>
                <Text
                  style={[styles.soundMeta, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {soundMode === "existing"
                    ? "Reusable sound"
                    : soundMode === "uploaded"
                      ? extractFileStem(uploadedSoundUri)
                      : "Original video audio"}
                </Text>
                {soundMode === "uploaded" && uploadedSoundUri ? (
                  <TextInput
                    value={uploadedSoundTitle}
                    onChangeText={setUploadedSoundTitle}
                    placeholder="Sound title"
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      {
                        color: colors.text,
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                      },
                    ]}
                  />
                ) : null}
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: colors.text }]}>
                      Keep original audio
                    </Text>
                    <Text
                      style={[styles.help, { color: colors.textSecondary }]}
                    >
                      Mix the video audio with the selected sound.
                    </Text>
                  </View>
                  <Switch
                    value={keepOriginalAudio}
                    onValueChange={(value) => {
                      setKeepOriginalAudio(value);
                      setOriginalAudioVolume(
                        value ? Math.max(0.3, originalAudioVolume) : 0,
                      );
                    }}
                    thumbColor="#FFFFFF"
                    trackColor={{
                      false: colors.border,
                      true: `${LIGHT_BROWN}88`,
                    }}
                  />
                </View>
                <Text style={[styles.label, { color: colors.text }]}>
                  Clip start
                </Text>
                <View style={styles.wrapRow}>
                  {[0, 5000, 10000, 15000].map((value) => (
                    <Chip
                      key={value}
                      active={soundStartMs === value}
                      colors={colors}
                      label={`${value / 1000}s`}
                      onPress={() => setSoundStartMs(value)}
                    />
                  ))}
                </View>
                <Text style={[styles.label, { color: colors.text }]}>
                  Sound volume
                </Text>
                <View style={styles.wrapRow}>
                  {[1, 0.8, 0.6].map((value) => (
                    <Chip
                      key={`s-${value}`}
                      active={Math.abs(soundVolume - value) < 0.001}
                      colors={colors}
                      label={`${Math.round(value * 100)}%`}
                      onPress={() => setSoundVolume(value)}
                    />
                  ))}
                </View>
                <Text style={[styles.label, { color: colors.text }]}>
                  Original audio
                </Text>
                <View style={styles.wrapRow}>
                  {[0, 0.3, 0.6, 1].map((value) => (
                    <Chip
                      key={`o-${value}`}
                      active={Math.abs(originalAudioVolume - value) < 0.001}
                      colors={colors}
                      label={`${Math.round(value * 100)}%`}
                      onPress={() => {
                        setOriginalAudioVolume(value);
                        setKeepOriginalAudio(value > 0);
                      }}
                    />
                  ))}
                </View>
              </View>
            </View>
          </>
        )}

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Caption
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe your post..."
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={500}
            style={[
              styles.descriptionInput,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            Hashtags still work. Example: `#abaya #kano`
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Price
          </Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="Optional price in NGN"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.text }]}>
                Negotiable
              </Text>
              <Text style={[styles.help, { color: colors.textSecondary }]}>
                Shows DM and Buy for priced posts.
              </Text>
            </View>
            <Switch
              value={isNegotiable}
              onValueChange={setIsNegotiable}
              thumbColor="#FFFFFF"
              trackColor={{ false: colors.border, true: `${LIGHT_BROWN}88` }}
            />
          </View>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.inlineHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Location
            </Text>
            <TouchableOpacity
              style={[
                styles.smallButton,
                { backgroundColor: colors.backgroundSecondary },
              ]}
              onPress={() => setLocationPickerVisible(true)}
            >
              <Text style={[styles.smallButtonText, { color: colors.text }]}>
                {locationLabel ? "Change" : "Select"}
              </Text>
            </TouchableOpacity>
          </View>
          {locationLabel ? (
            <View
              style={[
                styles.locationPill,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.locationText, { color: colors.text }]}>
                {locationLabel}
              </Text>
              <TouchableOpacity
                onPress={() => setLocation({ state: "", city: "" })}
              >
                <IconSymbol
                  name="xmark"
                  size={14}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Optional. Buyers can still DM for delivery details.
            </Text>
          )}
        </View>
      </KeyboardScreen>

      <Modal
        visible={locationPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationPickerVisible(false)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.inlineHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Choose Location
              </Text>
              <TouchableOpacity onPress={() => setLocationPickerVisible(false)}>
                <IconSymbol name="xmark" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={locationSearch}
              onChangeText={setLocationSearch}
              placeholder="Search state or city"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
            />
            <ScrollView showsVerticalScrollIndicator={false}>
              {locationSuggestions.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.modalRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    const nextLocation: NigeriaLocationOption = option;
                    setLocation({
                      state: nextLocation.state,
                      city: nextLocation.city,
                    });
                    setLocationPickerVisible(false);
                    setLocationSearch("");
                  }}
                >
                  <Text style={[styles.modalRowTitle, { color: colors.text }]}>
                    {option.city}
                  </Text>
                  <Text
                    style={[
                      styles.modalRowMeta,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {option.state}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={soundPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setSoundPickerVisible(false);
          setPreviewingSoundId(null);
        }}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                maxHeight: "82%",
              },
            ]}
          >
            <View style={styles.inlineHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Sound Library
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setSoundPickerVisible(false);
                  setPreviewingSoundId(null);
                }}
              >
                <IconSymbol name="xmark" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.wrapRow}>
              <Chip
                active={!showSavedOnly}
                colors={colors}
                label="All Sounds"
                onPress={() => setShowSavedOnly(false)}
              />
              <Chip
                active={showSavedOnly}
                colors={colors}
                label="Saved"
                onPress={() => setShowSavedOnly(true)}
              />
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalList}
            >
              {soundsLoading || savedSoundsLoading ? (
                <ActivityIndicator size="small" color={LIGHT_BROWN} />
              ) : displayedSounds.length === 0 ? (
                <Text style={[styles.help, { color: colors.textSecondary }]}>
                  No sounds found yet.
                </Text>
              ) : (
                displayedSounds.map((sound) => (
                  <MarketSoundRow
                    key={sound.id || sound.title}
                    colors={colors}
                    sound={sound}
                    selected={selectedSound?.id === sound.id}
                    isPreviewing={previewingSoundId === sound.id}
                    isSaved={Boolean(
                      sound.id && savedSoundIds.includes(sound.id),
                    )}
                    togglingSave={Boolean(
                      sound.id && busySoundIds.includes(sound.id),
                    )}
                    onPreview={() =>
                      setPreviewingSoundId((current) =>
                        current === sound.id ? null : sound.id || null,
                      )
                    }
                    onOpen={() => selectExistingSound(sound)}
                    onToggleSave={() => toggleSaveSound(sound)}
                  />
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 14,
  },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  primaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  publishButton: {
    minWidth: 92,
    minHeight: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  publishButtonText: { color: "#FFFFFF", fontWeight: "800" },
  content: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  card: { borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  row: { flexDirection: "row", gap: 10 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  segment: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  segmentText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  emptyBox: {
    minHeight: 180,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyText: { fontSize: 15, fontWeight: "700" },
  preview: { width: "100%", height: 280, borderRadius: 18 },
  thumbRow: { gap: 10 },
  thumbWrap: {
    width: 74,
    height: 74,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
  },
  thumb: { width: "100%", height: "100%" },
  thumbRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  addThumb: {
    width: 74,
    height: 74,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  videoBox: {
    width: "100%",
    height: 320,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#000000",
  },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontWeight: "700", fontSize: 13 },
  cover: { width: "100%", height: 170, borderRadius: 16 },
  inlineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  smallButton: {
    minHeight: 38,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButtonText: { fontWeight: "700", fontSize: 13 },
  mode: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modeText: { fontWeight: "700", fontSize: 12 },
  soundCard: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  soundTitle: { fontSize: 15, fontWeight: "800" },
  soundMeta: { fontSize: 12 },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  descriptionInput: {
    minHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: "top",
  },
  switchRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  label: { fontSize: 14, fontWeight: "700" },
  help: { fontSize: 12, lineHeight: 17 },
  locationPill: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  locationText: { fontSize: 14, fontWeight: "700" },
  chip: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 22,
    gap: 12,
    maxHeight: "76%",
  },
  modalRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowTitle: { fontSize: 15, fontWeight: "700" },
  modalRowMeta: { fontSize: 12, marginTop: 2 },
  modalList: { gap: 10, paddingBottom: 24 },
});
