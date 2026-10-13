# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Firebase Authentication
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.auth.api.** { *; }
-keep class com.google.android.gms.tasks.** { *; }

# React Native Firebase
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**

# Razorpay Checkout (rules from Razorpay's React Native integration docs)
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** {*;}
-optimizations !method/inlining/
-keepclasseswithmembers class * {
  public void onPayment*(...);
}
