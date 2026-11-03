import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Icon from '../atoms/Icon';
import { VehicleAvatar } from '../atoms/VehicleAvatar';
import { historicalVehicle } from '../../services/trip/historicalVehicle';
import type { TripHistoryRecord } from '../../types/tripHistory';
import { colors } from '../../theme';

export function HistoricalVehicleImage({ trip }: { trip: Pick<TripHistoryRecord, 'vehicleCategory'> }) {
  const [failedCategory, setFailedCategory] = useState<string | null>(null);
  const vehicle = historicalVehicle(trip);
  return <View style={styles.image}>
    {vehicle.artworkCategory && failedCategory !== vehicle.artworkCategory
      ? <VehicleAvatar vehicle={vehicle.artworkCategory} size={52} onError={() => setFailedCategory(vehicle.artworkCategory)} />
      : <Icon name={vehicle.icon} size={26} color={colors.navigationIcon} />}
  </View>;
}
const styles = StyleSheet.create({ image: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', backgroundColor: colors.surfaceContainerLow, borderRadius: 12 } });
