import React from 'react';
import { Polyline } from 'react-native-maps';
import { colors } from '../theme';
import type { Coordinate } from './types';

export interface RoutePolylineProps {
  coordinates: Coordinate[];
  color?: string;
  casingColor?: string;
  width?: number;
}

export const RoutePolyline: React.FC<RoutePolylineProps> = ({ 
  coordinates, 
  color = '#2563EB',
  casingColor = '#1E3A8A',
  width = 5 
}) => {
  if (!coordinates || coordinates.length === 0) return null;

  return (
    <>
      {/* Outer casing / border for crisp contrast against map roads */}
      <Polyline
        coordinates={coordinates}
        strokeColor={casingColor}
        strokeWidth={width + 3}
        lineCap="round"
        lineJoin="round"
        zIndex={1}
      />
      {/* Inner vibrant route line */}
      <Polyline
        coordinates={coordinates}
        strokeColor={color}
        strokeWidth={width}
        lineCap="round"
        lineJoin="round"
        zIndex={2}
      />
    </>
  );
};

