import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';

const NAV_ITEMS = [
  { label: 'Home', screen: 'Home' },
  { label: 'Weekly Spending', screen: 'Weekly' },
  { label: 'Monthly Spending', screen: 'Monthly' },
];

const SCREEN_LABELS = {
  Home: 'Home',
  Weekly: 'Weekly Spending',
  Monthly: 'Monthly Spending',
  WeekDetail: null, // label passed via prop
  MonthDetail: null,
  Settings: 'Settings',
};

export default function CustomHeader({ title }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const centerRef = useRef(null);

  const screenLabel = title || SCREEN_LABELS[route.name] || route.name;

  function openDropdown() {
    centerRef.current?.measure((fx, fy, width, height, px, py) => {
      setDropdownPos({ top: py + height, left: px, width });
      setDropdownVisible(true);
    });
  }

  function navigateTo(screen) {
    setDropdownVisible(false);
    navigation.navigate(screen);
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.card, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.inner}>
        {/* Left spacer */}
        <View style={styles.side} />

        {/* Center — tappable dropdown on all screens, chevron hidden on Home */}
        <Pressable
          ref={centerRef}
          onPress={openDropdown}
          style={styles.center}
          android_ripple={{ color: colors.border }}
        >
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {screenLabel}
          </Text>
          {(route.name === 'WeekDetail' || route.name === 'MonthDetail') && (
            <Text style={[styles.chevron, { color: colors.textMuted }]}> ˅</Text>
          )}
        </Pressable>

        {/* Right — settings gear */}
        <View style={styles.side}>
          <Pressable onPress={() => navigation.navigate('Settings')} style={styles.gearBtn}>
            <Text style={[styles.gear, { color: colors.textMuted }]}>⚙</Text>
          </Pressable>
        </View>
      </View>

      {/* Navigation Dropdown Modal */}
      <Modal
        transparent
        visible={dropdownVisible}
        animationType="fade"
        onRequestClose={() => setDropdownVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setDropdownVisible(false)}>
          <View style={StyleSheet.absoluteFill}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.dropdown,
                  {
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    minWidth: dropdownPos.width,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                {NAV_ITEMS.map(item => {
                  const isActive = route.name === item.screen;
                  return (
                    <TouchableOpacity
                      key={item.screen}
                      onPress={() => navigateTo(item.screen)}
                      style={[
                        styles.dropdownItem,
                        isActive && { backgroundColor: colors.accent + '22' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dropdownText,
                          { color: isActive ? colors.accent : colors.text },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingHorizontal: 12,
  },
  side: {
    width: 44,
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 14,
    marginTop: 2,
  },
  gearBtn: {
    padding: 4,
  },
  gear: {
    fontSize: 22,
  },
  dropdown: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
    zIndex: 100,
  },
  dropdownItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  dropdownText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
