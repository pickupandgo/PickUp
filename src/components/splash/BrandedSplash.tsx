import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { APP_NAME, APP_LOGO } from '../../config/brand';
import { JOURNEY_POINTS, JOURNEY_SEGMENTS, SPLASH_SIZE } from './journeyPath';
const inputs=JOURNEY_POINTS.map((_,i)=>i/(JOURNEY_POINTS.length-1));
const headings=inputs.map((_,i)=>`${JOURNEY_SEGMENTS[Math.min(i,JOURNEY_SEGMENTS.length-1)].angle+45}deg`);

function Pin({ drop=false }: { drop?: boolean }) {
  const point=JOURNEY_POINTS[drop ? JOURNEY_POINTS.length-1 : 0];
  return <View style={[styles.pinGroup,{left:point.x-16,top:point.y-40}]}>
    <View style={[styles.pinTip,drop && styles.drop]} />
    <View style={[styles.pinHead,drop && styles.drop]}><View style={styles.pinHole} /></View>
    <View style={[styles.pinLabel,drop && styles.dropLabel]}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.pinText}>{drop ? 'Drop' : 'Pickup'}</Text></View>
  </View>;
}
/** Simple bundled 2.5D illustration; no native scene, WebView, GPS or network. */
export default function BrandedSplash({ checkingAccount,onJourneyComplete }: { readonly checkingAccount:boolean;readonly onJourneyComplete:()=>void }) {
  const {width,height}=useWindowDimensions();
  const insets=useSafeAreaInsets();
  const scale=Math.min(width/SPLASH_SIZE.width,(height-insets.top-insets.bottom)/SPLASH_SIZE.height);
  const travel=useRef(new Animated.Value(0)).current;
  const [arrived,setArrived]=useState(false);
  useEffect(()=>{
    let active=true;
    let hold:ReturnType<typeof setTimeout>|undefined;
    travel.setValue(0);setArrived(false);
    const animation=Animated.sequence([Animated.delay(200),Animated.timing(travel,{toValue:1,duration:3000,easing:Easing.linear,useNativeDriver:true})]);
    animation.start(({finished})=>{if(active && finished){setArrived(true);hold=setTimeout(()=>{if(active)onJourneyComplete();},220);}});
    return ()=>{active=false;animation.stop();if(hold)clearTimeout(hold);};
  },[travel,onJourneyComplete]);
  return <View style={styles.page}>
    <View style={{width:SPLASH_SIZE.width*scale,height:SPLASH_SIZE.height*scale,marginTop:insets.top,marginBottom:insets.bottom}}>
      <View style={[styles.canvas,{left:(SPLASH_SIZE.width*scale-SPLASH_SIZE.width)/2,top:(SPLASH_SIZE.height*scale-SPLASH_SIZE.height)/2,transform:[{scale}]}]}>
        <Image source={require('../../assets/splash/journey-map.png')} style={styles.background} resizeMode="stretch" />
        <View style={styles.brand}>
          <Image source={APP_LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel={`${APP_NAME} logo`} />
          <Text style={styles.title}>{APP_NAME}</Text><Text style={styles.tagline}>Your goods, on the move.</Text>
        </View>
        <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible accessibilityLabel={arrived ? 'Delivery bike arrived at drop' : 'Delivery bike moving from pickup to drop'}>
          {JOURNEY_SEGMENTS.map((segment,i)=>{
            const line={left:segment.x-(segment.length+3)/2,top:segment.y-2,width:segment.length+3,transform:[{rotate:`${segment.angle}deg`}]};
            return <React.Fragment key={i}>
              <View style={[styles.route,styles.futureRoute,line]} />
              <Animated.View style={[styles.route,line,{opacity:travel.interpolate({inputRange:[i/100,(i+1)/100],outputRange:[0,1],extrapolate:'clamp'})}]} />
            </React.Fragment>;
          })}
          <Animated.View style={[styles.bikeAnchor,{transform:[{translateX:travel.interpolate({inputRange:inputs,outputRange:JOURNEY_POINTS.map(p=>p.x)})},{translateY:travel.interpolate({inputRange:inputs,outputRange:JOURNEY_POINTS.map(p=>p.y)})}]}]}>
            <Animated.View style={[styles.bikePivot,{transform:[{rotate:travel.interpolate({inputRange:inputs,outputRange:headings})}]}]}>
              <Image source={require('../../assets/splash/journey-rider.png')} style={styles.bike} resizeMode="contain" />
            </Animated.View>
          </Animated.View>
          <Pin /><Pin drop />
        </View>
        <Text style={styles.loadingLabel} accessibilityLiveRegion="polite">{checkingAccount ? 'Checking your account…' : 'Getting things ready…'}</Text>
      </View>
    </View>
  </View>;
}
const styles=StyleSheet.create({
  page:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:colors.splashBackground},
  canvas:{position:'absolute',width:SPLASH_SIZE.width,height:SPLASH_SIZE.height,overflow:'hidden',backgroundColor:colors.splashBackground},
  background:{...StyleSheet.absoluteFillObject,width:'100%',height:'100%'},
  brand:{position:'absolute',top:80,width:'100%',alignItems:'center'},
  logo:{width:158,height:164},
  title:{...typography.headlineLg,fontSize:30,lineHeight:40,fontWeight:'700',color:colors.homeAction,marginTop:spacing.xs},
  tagline:{...typography.bodyMd,color:colors.secondary,marginTop:spacing.xs},
  route:{position:'absolute',height:4,borderRadius:borderRadius.full,backgroundColor:colors.homePickup},
  futureRoute:{backgroundColor:colors.reviewAction},
  bikeAnchor:{position:'absolute',left:0,top:0,width:0,height:0},
  bikePivot:{position:'absolute',left:-38,top:-38,width:76,height:76},
  bike:{position:'absolute',left:0,top:-18,width:76,height:76},
  pinGroup:{position:'absolute',width:32,height:40},
  pinHead:{position:'absolute',top:0,width:32,height:32,borderRadius:borderRadius.full,backgroundColor:colors.homePickup,alignItems:'center',justifyContent:'center'},
  pinTip:{position:'absolute',top:17,left:6,width:20,height:20,borderRadius:borderRadius.sm,backgroundColor:colors.homePickup,transform:[{rotate:'45deg'}]},
  pinHole:{width:12,height:12,borderRadius:borderRadius.full,backgroundColor:colors.surface},
  drop:{backgroundColor:colors.homeAction},
  pinLabel:{position:'absolute',left:34,top:0,width:58,height:28,alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.xs,borderRadius:borderRadius.full,backgroundColor:colors.surface},
  dropLabel:{width:48},
  pinText:{...typography.labelSm,fontSize:11,lineHeight:16,fontWeight:'600',color:colors.homeAction},
  loadingLabel:{...typography.labelSm,position:'absolute',bottom:34,width:'100%',textAlign:'center',color:colors.secondary},
});
