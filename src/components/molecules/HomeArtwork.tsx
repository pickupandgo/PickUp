import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Ellipse, G, Path } from 'react-native-svg';
import { colors } from '../../theme';

/** Lightweight vector decoration; not a map or a representation of live trips. */
export function HomeDeliveryArtwork() {
  return (
    <View style={styles.landscape} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 360 96" preserveAspectRatio="none">
        <Path d="M0 78Q50 60 104 77T219 75T360 73V96H0Z" fill={colors.homeHill} />
        <Path d="M0 79Q50 67 104 77T219 75T360 73" fill="none" stroke={colors.homeRoute} strokeWidth="0.8" />
        {[40, 57, 326].map((x, i) => (
          <G key={x} transform={`translate(${x} ${i === 1 ? 58 : 49})`}>
            <Ellipse cy="6" rx={i === 1 ? 4 : 6} ry={i === 1 ? 9 : 13} fill={colors.homeTree} />
            <Path d="M0 2V27M0 10 3 6M0 15-3 11" stroke={colors.homeRoute} strokeWidth="0.7" fill="none" />
          </G>
        ))}
      </Svg>
      <Image source={require('../../../assets/vehicles/pickup_truck.png')}
        resizeMode="contain" style={styles.truck} />
    </View>
  );
}

export function HomeBrandMark() {
  return (
    <Svg width={27} height={32} viewBox="0 0 28 34" accessible={false}>
      <Path d="M14 1C6.8 1 2 6.3 2 12.4 2 20.1 14 33 14 33S26 20.1 26 12.4C26 6.3 21.2 1 14 1Z" fill={colors.startupBlue} />
      <Path d="M12 9V22M12 9H16C21 9 21 16 16 16H12" stroke={colors.onPrimary} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  landscape: { height: 96, overflow: 'hidden', borderRadius: 12, backgroundColor: colors.homeLandscape },
  truck: { position: 'absolute', width: 54, height: 46, left: '53%', bottom: 12, transform: [{ scaleX: -1 }] },
});
