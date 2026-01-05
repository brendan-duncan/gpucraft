/** 
 * @module math
 */

/**
 * Returns true if the object is a number.
 * @param {*} obj 
 * @return {bool}
 */
export function isNumber(obj) {
    return obj != null && obj.constructor === Number;
}

/**
 * Compare two floating-point numbers, testing if the two numbers closer than the given epsilon.
 * @param {number} a 
 * @param {number} b 
 * @param {number} epsilon 
 * @return {bool}
 */
export function equals(a, b, epsilon = Epsilon) {
    return Math.abs(b - a) <= epsilon; 
}

/**
 * Clamp the value x to the range [min, max].
 * @param {number} x 
 * @param {number} min 
 * @param {number} max 
 * @return {number}
 */
export function clamp(x, min, max) {
    return x < min ? min : x > max ? max : x;
}

/**
 * Linear interpolate between [min, max] using x. If x is outside of the range
 * [min, max], the interpolated value will be a linear extrapolation.
 * @param {number} x The interpolation amount, in the range [0, 1]. 
 * @param {number} min The start of the range to interpolate.
 * @param {number} max The end of the range to interpolate.
 * @return {number} The interpolated value.
 */
export function lerp(x, min, max) {
    const u = x < 0 ? 0 : x > 1 ? 1 : x;
    return u * (max - min) + min;
}

/**
 * Returns the sign of x, indicating whether x is positive, negative, or zero.
 * @function sign
 * @param {number} x
 * @return {number}
 */
export const sign = Math.sign;
/**
 * Returns the square root of x.
 * @function sqrt
 * @param {number} x
 * @return {number}
 */
export const sqrt = Math.sqrt;
/**
 * Returns the natural logarithm of x.
 * @function log
 * @param {number} x
 * @return {number}
 */
export const log = Math.log;
/**
 * Returns the sine of x.
 * @function sin
 * @param {number} x
 * @return {number}
 */
export const sin = Math.sin;
/**
 * Returns the cosine of x.
 * @function cos
 * @param {number} x
 * @return {number}
 */
export const cos = Math.cos;
/**
 * Returns the tangent of x.
 * @function tan
 * @param {number} x
 * @return {number}
 */
export const tan = Math.tan;
/**
 * Returns the arcsine of x.
 * @function asin
 * @param {number} x
 * @return {number}
 */
export const asin = Math.asin;
/**
 * Returns the arccosine of x.
 * @function acos
 * @param {number} x
 * @return {number}
 */
export const acos = Math.acos;
/**
 * Returns the arctangent of x.
 * @function sqrt
 * @param {number} x
 * @return {number}
 */
export const atan = Math.atan;
/**
 * Returns the largest integer less than or equal to x.
 * @function floor
 * @param {number} x
 * @return {number}
 */
export const floor = Math.floor;
/**
 * Returns the smallest integer greater than or equal to x.
 * @function ceil
 * @param {number} x
 * @return {number}
 */
export const ceil = Math.ceil;
/** 
 * Returns the absolute value of x.
 * @function abs
 * @param {number} x
 * @retrn {number}
 */
export const abs = Math.abs;

/**
 * @property {number} MaxValue
 * General value to consider as a maximum float value.
 */
export const MaxValue = 1.0e30;
/**
 * @property {number} Epsilon
 * General value to consider as an epsilon for float comparisons.
 */
export const Epsilon = 1.0e-6;
/**
 * @property {number} PI
 * 3.1415...
 */
export const PI = Math.PI;
/**
 * @property {number} PI_2
 * PI divided by 2
 */
export const PI_2 = Math.PI / 2;
/**
 * @property {number} PI2
 * PI multiplied by 2
 */
export const PI2 = Math.PI * 2;
/**
 * @property {number} DegreeToRadian
 * Conversion value for degrees to radians.
 */
export const DegreeToRadian = Math.PI / 180;
/**
 * @property {number} RadianToDegree
 * Conversion value for radians to degrees.
 */
export const RadianToDegree = 180 / Math.PI;

/**
 * Axis direction
 * @enum {number}
 * @readonly
 * @example
 * Axis.X: 0
 * Axis.Y: 1
 * Axis.Z: 2
 */
export const Axis = {
    X: 0,
    Y: 1,
    Z: 2
};

/**
 * Plane or frustum clip test result type.
 * @readonly
 * @enum {number}
 * @example
 * ClipTest.Inside: 0   // The object is completely inside the frustum or in front of the plane.
 * ClipTest.Outside: 1  // The object is completely outside the frustum or behind the plane.
 * ClipTest.Overlap: 2  // The object overlaps the plane or frustum.
 */
export const ClipTest = {
    Inside: 0,
    Outside: 1,
    Overlap: 2
};

/**
 * Order in which to apply euler rotations for a transformation.
 * @readonly
 * @enum {number}
 * @example
 * RotationOrder.Default: RotationOrder.ZYX
 * RotationOrder.ZYX: 0
 * RotationOrder.XYZ: 1,
 * RotationOrder.XZY: 2,
 * RotationOrder.YZX: 3,
 * RotationOrder.YXZ: 4,
 * RotationOrder.ZXY: 5,
 * 
 */
export const RotationOrder = {
    Default: 0, // Default is ZYX
    ZYX: 0,
    XYZ: 1,
    XZY: 2,
    YZX: 3,
    YXZ: 4,
    ZXY: 5
};


