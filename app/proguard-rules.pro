# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

#-keep class org.bouncycastle.** { *; }
#-keep class org.conscrypt.** { *; }
#-keep class org.openjsse.** { *; }
#-keep class okhttp3.internal.platform.BouncyCastlePlatform { *; }
#-keep class okhttp3.internal.platform.ConscryptPlatform { *; }
#-keep class okhttp3.internal.platform.OpenJSSEPlatform { *; }
-dontwarn org.bouncycastle.jsse.BCSSLParameters
-dontwarn org.bouncycastle.jsse.BCSSLSocket
-dontwarn org.bouncycastle.jsse.provider.BouncyCastleJsseProvider
-dontwarn org.conscrypt.Conscrypt$Version
-dontwarn org.conscrypt.Conscrypt
-dontwarn org.conscrypt.ConscryptHostnameVerifier
-dontwarn org.openjsse.javax.net.ssl.SSLParameters
-dontwarn org.openjsse.javax.net.ssl.SSLSocket
-dontwarn org.openjsse.net.ssl.OpenJSSE

-dontwarn org.slf4j.impl.StaticLoggerBinder
#-keep class com.jayteealao.trails.network.** { *; }
#-keep interface com.jayteealao.trails.network.pocket.PocketService {
#  *;
#}
#keep rules for the Retrofit 2.0 implementation
#-keep class retrofit2.** { *; }
#-keep class com.google.gson.** { *; }

# Retrofit does reflection on generic parameters. InnerClasses is required to use Signature and
# EnclosingMethod is required to use InnerClasses.
-keepattributes Signature, InnerClasses, EnclosingMethod

# Retrofit does reflection on method and parameter annotations.
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations

# Keep annotation default values (e.g., retrofit2.http.Field.encoded).
-keepattributes AnnotationDefault

# Retain service method parameters when optimizing.
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

# Ignore annotation used for build tooling.
-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRERequirement

# Ignore JSR 305 annotations for embedding nullability information.
-dontwarn javax.annotation.**

# Guarded by a NoClassDefFoundError try/catch and only used when on the classpath.
-dontwarn kotlin.Unit

# Top-level functions that can only be used by Kotlin.
-dontwarn retrofit2.KotlinExtensions
-dontwarn retrofit2.KotlinExtensions$*

# With R8 full mode, it sees no subtypes of Retrofit interfaces since they are created with a Proxy
# and replaces all potential values with null. Explicitly keeping the interfaces prevents this.
-if interface * { @retrofit2.http.* <methods>; }
-keep,allowobfuscation interface <1>

# Keep inherited services.
-if interface * { @retrofit2.http.* <methods>; }
-keep,allowobfuscation interface * extends <1>

# Keep generic signature of Call, Response (R8 full mode strips signatures from non-kept items).
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# With R8 full mode generic signatures are stripped for classes that are not
# kept. Suspend functions are wrapped in continuations where the type argument
# is used.
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

-dontwarn rx.**

-dontwarn okio.**

-dontwarn com.squareup.okhttp.**
-keep class com.squareup.okhttp.** { *; }
-keep interface com.squareup.okhttp.** { *; }

-keepattributes Signature
-keepattributes *Annotation*

#gson rules
-keep class com.jayteealao.trails.network.** { *; }
-keepclassmembers class com.jayteealao.trails.network.** { *; }
-keep class com.jayteealao.trails.services.** { *; }
-keepclassmembers class com.jayteealao.trails.services.** { *; }
# Prevent proguard from stripping interface information from TypeAdapterFactory,
# JsonSerializer, JsonDeserializer instances (so they can be used in @JsonAdapter)
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer

-keepclasseswithmembers class * {
    @com.google.gson.annotations.* <methods>;
}
-keep class kotlin.Metadata { *; }
-keepclassmembers class kotlin.Metadata {
    public <methods>;
}
-keepnames @kotlin.Metadata class com.jayteealao.trails.network.**
-keep class com.jayteealao.trails.network** { *; }
-keepclassmembers class com.jayteealao.trails.network.** { *; }
-keepnames @kotlin.Metadata class com.jayteealao.trails.services.**
-keep class com.jayteealao.trails.services** { *; }
-keepclassmembers class com.jayteealao.trails.services.** { *; }

# Retain service method parameters when optimizing.
-keep class com.skydoves.sandwich.adapters.ApiResponseCallAdapterFactory
-keep class com.skydoves.sandwich.** { *; }
-keep interface com.skydoves.sandwich.** { *; }

-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

-keep class org.apache.http.conn.ssl.AllowAllHostnameVerifier {
    public static org.apache.http.conn.ssl.AllowAllHostnameVerifier INSTANCE;
}
