import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { AnimatedPressable } from '@/components/animated-pressable';
import { haptics } from '@/lib/utils/haptics';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';

const MAX_HASHTAGS = 10;

interface HashtagInputProps {
  hashtags: string[];
  onHashtagsChange: (hashtags: string[]) => void;
  maxHashtags?: number;
}

export function HashtagInput({
  hashtags,
  onHashtagsChange,
  maxHashtags = MAX_HASHTAGS,
}: HashtagInputProps) {
  const { colors } = useTheme();
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Fetch trending hashtags
  useEffect(() => {
    const q = query(
      collection(firestore, 'trendingHashtags'),
      orderBy('count', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const trending: string[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.tag && typeof data.tag === 'string') {
            trending.push(data.tag);
          }
        });
        setSuggestions(trending);
      },
      (error) => {
        console.error('Error fetching trending hashtags:', error);
        // Continue without suggestions
      }
    );

    return () => unsubscribe();
  }, []);

  const parseHashtags = (text: string): string[] => {
    const hashtagRegex = /#[\w]+/g;
    const matches = text.match(hashtagRegex) || [];
    return matches.map((tag) => tag.substring(1).toLowerCase()).filter(Boolean);
  };

  const handleInputChange = (text: string) => {
    setInputValue(text);

    // Show suggestions if user types '#'
    if (text.includes('#')) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleInputSubmit = () => {
    const newHashtags = parseHashtags(inputValue);
    const uniqueNewHashtags = newHashtags.filter(
      (tag) => !hashtags.includes(tag) && tag.length > 0
    );

    if (hashtags.length + uniqueNewHashtags.length > maxHashtags) {
      haptics.error();
      return;
    }

    if (uniqueNewHashtags.length > 0) {
      haptics.success();
      onHashtagsChange([...hashtags, ...uniqueNewHashtags]);
      setInputValue('');
      setShowSuggestions(false);
    }
  };

  const addHashtag = (tag: string) => {
    const normalizedTag = tag.toLowerCase().replace('#', '');
    if (hashtags.includes(normalizedTag) || hashtags.length >= maxHashtags) {
      haptics.error();
      return;
    }

    haptics.light();
    onHashtagsChange([...hashtags, normalizedTag]);
    setInputValue('');
    setShowSuggestions(false);
  };

  const removeHashtag = (tag: string) => {
    haptics.light();
    onHashtagsChange(hashtags.filter((t) => t !== tag));
  };

  const filteredSuggestions = suggestions.filter(
    (tag) =>
      !hashtags.includes(tag.toLowerCase()) &&
      (inputValue === '' || tag.toLowerCase().includes(inputValue.toLowerCase().replace('#', '')))
  );

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>
        Hashtags ({hashtags.length}/{maxHashtags})
      </Text>

      {/* Hashtag Chips */}
      {hashtags.length > 0 && (
        <View style={styles.chipsContainer}>
          {hashtags.map((tag, index) => (
            <View
              key={index}
              style={[styles.chip, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.chipText, { color: colors.text }]}>#{tag}</Text>
              <AnimatedPressable
                onPress={() => removeHashtag(tag)}
                scaleValue={0.9}
                style={styles.removeChipButton}>
                <IconSymbol name="xmark" size={14} color={colors.textSecondary} />
              </AnimatedPressable>
            </View>
          ))}
        </View>
      )}

      {/* Input */}
      <View style={[styles.inputContainer, { borderColor: colors.border }]}>
        <IconSymbol name="tag" size={20} color={colors.textSecondary} />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="Add hashtags (e.g., #fashion #vintage)"
          placeholderTextColor={colors.textSecondary}
          value={inputValue}
          onChangeText={handleInputChange}
          onSubmitEditing={handleInputSubmit}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Suggestions */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <View style={[styles.suggestionsContainer, { backgroundColor: colors.card }]}>
          <Text style={[styles.suggestionsTitle, { color: colors.textSecondary }]}>
            Trending
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {filteredSuggestions.slice(0, 10).map((tag, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.suggestionChip, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => addHashtag(tag)}>
                <Text style={[styles.suggestionText, { color: colors.text }]}>#{tag}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  removeChipButton: {
    padding: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  suggestionsContainer: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  suggestionsTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  suggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  suggestionText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
