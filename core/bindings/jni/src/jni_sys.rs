#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::ffi::c_void;

pub type jint = i32;
pub type jlong = i64;
pub type jbyte = i8;
pub type jboolean = u8;
pub type jchar = u16;
pub type jshort = i16;
pub type jfloat = f32;
pub type jdouble = f64;
pub type jsize = jint;

pub type jobject = *mut c_void;
pub type jclass = jobject;
pub type jstring = jobject;
pub type jarray = jobject;
pub type jobjectArray = jarray;
pub type jbyteArray = jarray;
pub type jintArray = jarray;
pub type jdoubleArray = jarray;

pub type JNIEnv = *const JNINativeInterface;
pub type FnPtr = *const c_void;

/// Exact 233-slot JNINativeInterface vtable matching Android NDK `jni.h` (JNI 1.6).
#[repr(C)]
pub struct JNINativeInterface {
    pub reserved0: FnPtr,
    pub reserved1: FnPtr,
    pub reserved2: FnPtr,
    pub reserved3: FnPtr,
    pub GetVersion: unsafe extern "system" fn(*mut JNIEnv) -> jint,
    pub _slot5_define_class: FnPtr,
    pub _slot6_find_class: FnPtr,
    pub _slot7_from_reflected_method: FnPtr,
    pub _slot8_from_reflected_field: FnPtr,
    pub _slot9_to_reflected_method: FnPtr,
    pub _slot10_get_superclass: FnPtr,
    pub _slot11_is_assignable_from: FnPtr,
    pub _slot12_to_reflected_field: FnPtr,
    pub _slot13_throw: FnPtr,
    pub _slot14_throw_new: FnPtr,
    pub _slot15_exception_occurred: FnPtr,
    pub _slot16_exception_describe: FnPtr,
    pub _slot17_exception_clear: FnPtr,
    pub _slot18_fatal_error: FnPtr,
    pub _slot19_push_local_frame: FnPtr,
    pub _slot20_pop_local_frame: FnPtr,
    pub _slot21_new_global_ref: FnPtr,
    pub _slot22_delete_global_ref: FnPtr,
    pub DeleteLocalRef: unsafe extern "system" fn(*mut JNIEnv, jobject),
    pub _slots24_to_162: [FnPtr; 139], // slots 24..=162
    pub NewString: unsafe extern "system" fn(*mut JNIEnv, *const jchar, jsize) -> jstring,
    pub GetStringLength: unsafe extern "system" fn(*mut JNIEnv, jstring) -> jsize,
    pub GetStringChars: unsafe extern "system" fn(*mut JNIEnv, jstring, *mut jboolean) -> *const jchar,
    pub ReleaseStringChars: unsafe extern "system" fn(*mut JNIEnv, jstring, *const jchar),
    pub NewStringUTF: unsafe extern "system" fn(*mut JNIEnv, *const i8) -> jstring,
    pub GetStringUTFLength: unsafe extern "system" fn(*mut JNIEnv, jstring) -> jsize,
    pub GetStringUTFChars: unsafe extern "system" fn(*mut JNIEnv, jstring, *mut jboolean) -> *const i8,
    pub ReleaseStringUTFChars: unsafe extern "system" fn(*mut JNIEnv, jstring, *const i8),
    pub GetArrayLength: unsafe extern "system" fn(*mut JNIEnv, jarray) -> jsize,
    pub NewObjectArray: FnPtr,
    pub GetObjectArrayElement: unsafe extern "system" fn(*mut JNIEnv, jobjectArray, jsize) -> jobject,
    pub SetObjectArrayElement: FnPtr,
    pub _slot175_new_boolean_array: FnPtr,
    pub NewByteArray: unsafe extern "system" fn(*mut JNIEnv, jsize) -> jbyteArray,
    pub _slot177_new_char_array: FnPtr,
    pub _slot178_new_short_array: FnPtr,
    pub NewIntArray: unsafe extern "system" fn(*mut JNIEnv, jsize) -> jintArray,
    pub _slot180_new_long_array: FnPtr,
    pub _slot181_new_float_array: FnPtr,
    pub NewDoubleArray: unsafe extern "system" fn(*mut JNIEnv, jsize) -> jdoubleArray,
    pub _slots183_to_199: [FnPtr; 17], // slots 183..=199
    pub GetByteArrayRegion: unsafe extern "system" fn(*mut JNIEnv, jbyteArray, jsize, jsize, *mut jbyte),
    pub _slot201_get_char_array_region: FnPtr,
    pub _slot202_get_short_array_region: FnPtr,
    pub GetIntArrayRegion: unsafe extern "system" fn(*mut JNIEnv, jintArray, jsize, jsize, *mut jint),
    pub _slots204_to_207: [FnPtr; 4], // slots 204..=207
    pub SetByteArrayRegion: unsafe extern "system" fn(*mut JNIEnv, jbyteArray, jsize, jsize, *const jbyte),
    pub _slots209_to_213: [FnPtr; 5], // slots 209..=213
    pub SetDoubleArrayRegion: unsafe extern "system" fn(*mut JNIEnv, jdoubleArray, jsize, jsize, *const jdouble),
    pub _slots215_to_227: [FnPtr; 13], // slots 215..=227
    pub ExceptionCheck: unsafe extern "system" fn(*mut JNIEnv) -> jboolean,
    pub NewDirectByteBuffer: unsafe extern "system" fn(*mut JNIEnv, *mut c_void, jlong) -> jobject,
    pub GetDirectBufferAddress: unsafe extern "system" fn(*mut JNIEnv, jobject) -> *mut c_void,
    pub GetDirectBufferCapacity: unsafe extern "system" fn(*mut JNIEnv, jobject) -> jlong,
    pub _slot232_get_object_ref_type: FnPtr,
}

pub const JNI_TRUE: jboolean = 1;
pub const JNI_FALSE: jboolean = 0;

#[inline]
unsafe fn vtable<'a>(env: *mut JNIEnv) -> &'a JNINativeInterface {
    &*(*env)
}

pub unsafe fn jstring_to_option_string(env: *mut JNIEnv, s: jstring) -> Option<String> {
    if s.is_null() {
        return None;
    }
    let vt = vtable(env);
    let len = (vt.GetStringLength)(env, s);
    if len <= 0 {
        return Some(String::new());
    }
    let chars = (vt.GetStringChars)(env, s, std::ptr::null_mut());
    if chars.is_null() {
        return Some(String::new());
    }
    let slice = std::slice::from_raw_parts(chars, len as usize);
    let out = String::from_utf16_lossy(slice);
    (vt.ReleaseStringChars)(env, s, chars);
    Some(out)
}

pub unsafe fn jstring_to_string(env: *mut JNIEnv, s: jstring) -> String {
    jstring_to_option_string(env, s).unwrap_or_default()
}

pub unsafe fn string_to_jstring(env: *mut JNIEnv, s: &str) -> jstring {
    let vt = vtable(env);
    let utf16: Vec<u16> = s.encode_utf16().collect();
    (vt.NewString)(env, utf16.as_ptr(), utf16.len() as jsize)
}

pub unsafe fn jbytearray_to_vec(env: *mut JNIEnv, arr: jbyteArray) -> Option<Vec<u8>> {
    if arr.is_null() {
        return None;
    }
    let vt = vtable(env);
    let len = (vt.GetArrayLength)(env, arr);
    if len <= 0 {
        return Some(Vec::new());
    }
    let mut out = vec![0u8; len as usize];
    (vt.GetByteArrayRegion)(env, arr, 0, len, out.as_mut_ptr() as *mut jbyte);
    Some(out)
}

pub unsafe fn vec_to_jbytearray(env: *mut JNIEnv, data: &[u8]) -> jbyteArray {
    let vt = vtable(env);
    let arr = (vt.NewByteArray)(env, data.len() as jsize);
    if !arr.is_null() && !data.is_empty() {
        (vt.SetByteArrayRegion)(env, arr, 0, data.len() as jsize, data.as_ptr() as *const jbyte);
    }
    arr
}

pub unsafe fn jintarray_to_vec(env: *mut JNIEnv, arr: jintArray) -> Vec<i32> {
    if arr.is_null() {
        return Vec::new();
    }
    let vt = vtable(env);
    let len = (vt.GetArrayLength)(env, arr);
    if len <= 0 {
        return Vec::new();
    }
    let mut out = vec![0i32; len as usize];
    (vt.GetIntArrayRegion)(env, arr, 0, len, out.as_mut_ptr());
    out
}

pub unsafe fn vec_to_jdoublearray(env: *mut JNIEnv, data: &[f64]) -> jdoubleArray {
    let vt = vtable(env);
    let arr = (vt.NewDoubleArray)(env, data.len() as jsize);
    if !arr.is_null() && !data.is_empty() {
        (vt.SetDoubleArrayRegion)(env, arr, 0, data.len() as jsize, data.as_ptr());
    }
    arr
}

pub unsafe fn jobjectarray_len(env: *mut JNIEnv, arr: jobjectArray) -> usize {
    if arr.is_null() {
        return 0;
    }
    let len = (vtable(env).GetArrayLength)(env, arr);
    len.max(0) as usize
}

pub unsafe fn jobjectarray_get(env: *mut JNIEnv, arr: jobjectArray, idx: usize) -> jobject {
    if arr.is_null() {
        return std::ptr::null_mut();
    }
    (vtable(env).GetObjectArrayElement)(env, arr, idx as jsize)
}

pub unsafe fn delete_local_ref(env: *mut JNIEnv, obj: jobject) {
    if !obj.is_null() {
        (vtable(env).DeleteLocalRef)(env, obj);
    }
}

pub unsafe fn direct_buffer_mut_slice<'a>(env: *mut JNIEnv, buf: jobject) -> Option<&'a mut [u8]> {
    if buf.is_null() {
        return None;
    }
    let vt = vtable(env);
    let addr = (vt.GetDirectBufferAddress)(env, buf);
    let cap = (vt.GetDirectBufferCapacity)(env, buf);
    if addr.is_null() || cap <= 0 {
        return None;
    }
    Some(std::slice::from_raw_parts_mut(addr as *mut u8, cap as usize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jni_vtable_matches_exact_233_slots() {
        assert_eq!(
            std::mem::size_of::<JNINativeInterface>(),
            233 * std::mem::size_of::<FnPtr>()
        );
        assert_eq!(std::mem::offset_of!(JNINativeInterface, NewString), 163 * std::mem::size_of::<FnPtr>());
        assert_eq!(std::mem::offset_of!(JNINativeInterface, GetArrayLength), 171 * std::mem::size_of::<FnPtr>());
        assert_eq!(std::mem::offset_of!(JNINativeInterface, NewByteArray), 176 * std::mem::size_of::<FnPtr>());
        assert_eq!(std::mem::offset_of!(JNINativeInterface, GetByteArrayRegion), 200 * std::mem::size_of::<FnPtr>());
        assert_eq!(std::mem::offset_of!(JNINativeInterface, SetByteArrayRegion), 208 * std::mem::size_of::<FnPtr>());
        assert_eq!(std::mem::offset_of!(JNINativeInterface, SetDoubleArrayRegion), 214 * std::mem::size_of::<FnPtr>());
        assert_eq!(std::mem::offset_of!(JNINativeInterface, GetDirectBufferAddress), 230 * std::mem::size_of::<FnPtr>());
        assert_eq!(std::mem::offset_of!(JNINativeInterface, GetDirectBufferCapacity), 231 * std::mem::size_of::<FnPtr>());
    }
}
