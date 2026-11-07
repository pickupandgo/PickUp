/** Decorative splash artwork coordinates; independent of live trip navigation. */
export const SPLASH_SIZE = { width: 390, height: 824 };
type Point = { x: number; y: number };
function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1-t;
  return { x: u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,
    y: u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y };
}
const curve = Array.from({ length: 201 }, (_, index) => index <= 100
  ? cubic({x:49,y:643}, {x:166,y:643}, {x:144,y:565}, {x:221,y:526}, index/100)
  : cubic({x:221,y:526}, {x:289,y:492}, {x:330,y:499}, {x:322,y:425}, (index-100)/100));
const distances = [0];
curve.slice(1).forEach((p,index) => distances.push(distances[index]+Math.hypot(p.x-curve[index].x,p.y-curve[index].y)));
export const JOURNEY_POINTS = Array.from({ length: 101 }, (_, index) => {
  const distance = distances[distances.length-1]*index/100;
  const next = distances.findIndex(value => value>=distance);
  if (next<=0) return curve[0];
  const t=(distance-distances[next-1])/(distances[next]-distances[next-1]);
  return { x:curve[next-1].x+(curve[next].x-curve[next-1].x)*t, y:curve[next-1].y+(curve[next].y-curve[next-1].y)*t };
});
export const JOURNEY_SEGMENTS = JOURNEY_POINTS.slice(0,-1).map((p,index) => {
  const q=JOURNEY_POINTS[index+1];
  return { x:(p.x+q.x)/2, y:(p.y+q.y)/2, length:Math.hypot(q.x-p.x,q.y-p.y), angle:Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI };
});
