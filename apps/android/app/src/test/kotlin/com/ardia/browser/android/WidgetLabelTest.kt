package com.ardia.browser.android

import android.view.LayoutInflater
import androidx.test.core.app.ApplicationProvider
import com.ardia.browser.android.system.ArdiaWidgets
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WidgetLabelTest {
    private val context get() = ApplicationProvider.getApplicationContext<ArdiaApplication>()

    @Test
    fun eachWidgetHasARealLabelFromItsFirstFrame() {
        assertEquals("Ardia Search", ArdiaWidgets.label(context, ArdiaWidgets.Kind.Search))
        assertEquals("Ardia, Your Mac’s Tabs", ArdiaWidgets.label(context, ArdiaWidgets.Kind.MacTabs))
        val inflater = LayoutInflater.from(context)
        assertEquals("Ardia Search", inflater.inflate(R.layout.widget_search_initial, null).contentDescription)
        assertEquals("Ardia, Your Mac’s Tabs", inflater.inflate(R.layout.widget_mac_tabs_initial, null).contentDescription)
    }

    @Test
    fun theProvidersStartFromTheLabelledLayouts() {
        for ((info, layout) in listOf(R.xml.search_widget_info to R.layout.widget_search_initial, R.xml.mac_tabs_widget_info to R.layout.widget_mac_tabs_initial)) {
            val parser = context.resources.getXml(info)
            var initial = 0
            while (parser.next() != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
                if (parser.eventType == org.xmlpull.v1.XmlPullParser.START_TAG && parser.name == "appwidget-provider") {
                    initial = parser.getAttributeResourceValue("http://schemas.android.com/apk/res/android", "initialLayout", 0)
                }
            }
            assertEquals(layout, initial)
        }
    }
}
