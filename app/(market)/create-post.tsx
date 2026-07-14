import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MarketVideoSurface } from "@/components/market/market-video-surface";
import { showToast } from "@/components/toast";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { marketPostsApi } from "@/lib/api/market-posts";
import { useUploadProgress } from "@/lib/context/upload-progress";
import { scheduleNotification } from "@/lib/hooks/use-notifications";
import {
    NIGERIA_LOCATION_OPTIONS,
} from "@/lib/constants/nigeria-locations";
import { useUser } from "@/lib/firebase/auth/use-user";
import { useTheme } from "@/lib/theme/theme-context";
import { canPostToMarketStreet } from "@/lib/utils/auth-helpers";
import { getLoginRoute } from "@/lib/utils/auth-routes";
import { haptics } from "@/lib/utils/haptics";
import {
    pickImage,
    pickMultipleImages,
    pickVideo,
} from "@/lib/utils/image-upload";

const LIGHT_BROWN = "#A67C52";
const MAX_IMAGES = 20;
const HASHTAG_REGEX = /(^|\s)#([a-zA-Z0-9_]+)/g;
const FALLBACK_TRENDING_HASHTAGS = [
  "fashion",
  "lagos",
  "abuja",
  "sale",
  "new",
  "vintage",
  "beauty",
  "phones",
];

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

function normalizeCreatePostError(error: unknown): string {
  const raw = (error as any)?.message || "Unable to publish post.";
  const code = String((error as any)?.code || "").toLowerCase();
  const lower = String(raw).toLowerCase();
  if (code.includes("permission") || lower.includes("permission")) {
    return "Permission denied while publishing. Please try again in a moment.";
  }
  if (lower.includes("photo")) return "Please add at least one photo.";
  if (lower.includes("video")) return "Please pick a video before publishing.";
  return String(raw);
}

export default function CreatePostScreen() {
  const { user } = useUser();
  const { colors } = useTheme();
  const { startUpload, setUploadProgress, finishUpload, failUpload } = useUploadProgress();
  const insets = useSafeAreaInsets();

  const [postMode, setPostMode] = useState<"photo" | "video">("photo");
  const [images, setImages] = useState<string[]>([]);
  const [videoUri, setVideoUri] = useState("");
  const [coverImageUri, setCoverImageUri] = useState("");
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [isNegotiable, setIsNegotiable] = useState(false);
  const [location, setLocation] = useState({ state: "", city: "" });
  const [locationSearch, setLocationSearch] = useState("");
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [captionFocused, setCaptionFocused] = useState(false);
  const [trendingSuggestions, setTrendingSuggestions] = useState<string[]>([]);

  const captionRef = useRef<TextInput>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tags = await marketPostsApi.listTrendingHashtags(30);
        const next = tags
          .map((item) => String(item.tag || "").trim().toLowerCase())
          .filter(Boolean);
        if (!cancelled) {
          setTrendingSuggestions(next.length > 0 ? next : FALLBACK_TRENDING_HASHTAGS);
        }
      } catch (error) {
        console.warn("Trending hashtag suggestions unavailable:", error);
        if (!cancelled) setTrendingSuggestions(FALLBACK_TRENDING_HASHTAGS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Update description; activeSuggestions derives partial-tag live from description
  const handleCaptionChange = useCallback((text: string) => {
    setDescription(text);
  }, []);

  const hashtags = useMemo(() => extractHashtags(description), [description]);

  const hashtagBar = useMemo(() => {
    if (!captionFocused) {
      return { visible: false, label: "TRENDING", chips: [] as string[] };
    }

    const pool = trendingSuggestions.length > 0
      ? trendingSuggestions
      : FALLBACK_TRENDING_HASHTAGS;
    const usedTags = new Set(hashtags);
    const unused = pool.filter((tag) => !usedTags.has(tag));
    const lastWord = description.trimEnd().split(/\s/).pop() ?? "";

    if (lastWord.startsWith("#")) {
      const partial = lastWord.slice(1).toLowerCase();
      const matches = unused
        .filter((tag) => partial === "" || tag.startsWith(partial))
        .slice(0, 12);

      if (matches.length > 0) {
        return { visible: true, label: "SUGGESTIONS", chips: matches };
      }
    }

    return { visible: true, label: "TRENDING", chips: unused.slice(0, 12) };
  }, [captionFocused, description, trendingSuggestions, hashtags]);

  const applyHashtagSuggestion = useCallback((tag: string) => {
    haptics.light();
    setDescription((prev) => {
      const trimmed = prev.trimEnd();
      const lastWord = trimmed.split(/\s/).pop() ?? "";

      if (lastWord.startsWith("#")) {
        const words = prev.split(/(\s)/);
        for (let i = words.length - 1; i >= 0; i--) {
          if (words[i].startsWith("#")) {
            words[i] = `#${tag}`;
            break;
          }
        }
        return `${words.join("")} `;
      }

      const spacer = trimmed.length > 0 && !trimmed.endsWith(" ") ? " " : "";
      return `${trimmed}${spacer}#${tag} `;
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

  const canPublish = useMemo(() => {
    if (publishing) return false;
    if (!title.trim()) return false;
    return postMode === "photo" ? images.length > 0 : Boolean(videoUri);
  }, [images.length, postMode, publishing, title, videoUri]);

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

  const resetForm = () => {
    setPostMode("photo");
    setImages([]);
    setVideoUri("");
    setCoverImageUri("");
    setTitle("");
    setDescription("");
    setPrice("");
    setIsNegotiable(false);
    setLocation({ state: "", city: "" });
    setLocationSearch("");
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
      title: title.trim().slice(0, 80) || undefined,
      description: description.trim() || undefined,
      price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
      isNegotiable: Number.isFinite(parsedPrice) ? isNegotiable : false,
      location: locationLabel ? location : undefined,
      contactMethod: "in-app" as const,
      soundSelection: postMode === "video" ? { mode: "original" as const } : undefined,
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

          <View style={styles.titleSection}>
            <Text style={[styles.fieldLabel, { color: LIGHT_BROWN }]}>TITLE</Text>
            <TextInput
              value={title}
              onChangeText={(value) => setTitle(value.slice(0, 80))}
              placeholder="Product name"
              placeholderTextColor={colors.textSecondary}
              maxLength={80}
              style={[styles.titleInput, { color: colors.text, borderBottomColor: colors.border }]}
            />
            <Text style={[styles.charCount, { color: colors.textSecondary, alignSelf: "flex-end", paddingHorizontal: 14, paddingBottom: 8 }]}>
              {title.length}/80
            </Text>
          </View>

          {/* Caption section */}
          <View style={[styles.captionSection, { backgroundColor: isDark ? `${LIGHT_BROWN}07` : `${LIGHT_BROWN}05` }]}>
            <Text style={[styles.fieldLabel, { color: LIGHT_BROWN, paddingHorizontal: 14, paddingTop: 10 }]}>CAPTION</Text>
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

          {/* Trending while caption is focused; autocomplete replaces it while typing #tag */}
          {hashtagBar.visible && (
            <View style={[styles.suggestionsWrap, { borderTopColor: colors.border }]}>
              <Text style={[styles.suggestionsLabel, { color: LIGHT_BROWN }]}>
                {hashtagBar.label}
              </Text>
              {hashtagBar.chips.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.suggestionsRow}
                  keyboardShouldPersistTaps="always"
                >
                  {hashtagBar.chips.map((tag) => (
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
              ) : null}
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

  titleSection: { paddingTop: 12 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  titleInput: {
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

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

  formRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  rowIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowPrefix: { fontSize: 15, fontWeight: "700" },
  rowInput: { flex: 1, fontSize: 14, minHeight: 28 },
  rowValue: { fontSize: 14, fontWeight: "600" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowRightLabel: { fontSize: 11, fontWeight: "600" },

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
