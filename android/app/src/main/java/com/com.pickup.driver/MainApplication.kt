package com.multipleride.driver

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.multipleride.driver.location.LocationPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Manually linked packages:
          add(LocationPackage())
          add(OnboardingFilesPackage())
          add(PrivateDocumentsPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannels(listOf(
        NotificationChannel("ride_updates", "Trip updates", NotificationManager.IMPORTANCE_HIGH),
        NotificationChannel("chat_messages", "Trip messages", NotificationManager.IMPORTANCE_DEFAULT),
        NotificationChannel("partner_updates", "Partner updates", NotificationManager.IMPORTANCE_DEFAULT),
      ))
    }
    loadReactNative(this)
  }
}
