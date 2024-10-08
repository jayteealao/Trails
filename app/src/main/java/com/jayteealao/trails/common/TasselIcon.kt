package com.jayteealao.trails.common

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

val Tassel_App_Icon: ImageVector
    get() {
        if (_Tassel_App_Icon != null) {
            return _Tassel_App_Icon!!
        }
        _Tassel_App_Icon = ImageVector.Builder(
            name = "Tassel_App_Icon",
            defaultWidth = 32.dp,
            defaultHeight = 32.dp,
            viewportWidth = 32f,
            viewportHeight = 32f
        ).apply {
            path(
                fill = SolidColor(Color(0xFF000000)),
                fillAlpha = 1.0f,
                stroke = null,
                strokeAlpha = 1.0f,
                strokeLineWidth = 1.0f,
                strokeLineCap = StrokeCap.Butt,
                strokeLineJoin = StrokeJoin.Miter,
                strokeLineMiter = 1.0f,
                pathFillType = PathFillType.NonZero
            ) {
                moveTo(22.6666f, 4.5f)
                horizontalLineTo(9.33329f)
                curveTo(7.86660f, 4.50f, 6.680f, 5.70f, 6.680f, 7.16670f)
                lineTo(6.66663f, 28.5f)
                lineTo(16f, 24.5f)
                lineTo(25.3333f, 28.5f)
                verticalLineTo(7.16667f)
                curveTo(25.33330f, 5.70f, 24.13330f, 4.50f, 22.66660f, 4.50f)
                close()
                moveTo(22.6666f, 24.5f)
                lineTo(16f, 21.5933f)
                lineTo(9.33329f, 24.5f)
                verticalLineTo(7.16667f)
                horizontalLineTo(22.6666f)
                verticalLineTo(24.5f)
                close()
            }
            path(
                fill = SolidColor(Color(0xFF000000)),
                fillAlpha = 1.0f,
                stroke = null,
                strokeAlpha = 1.0f,
                strokeLineWidth = 1.0f,
                strokeLineCap = StrokeCap.Butt,
                strokeLineJoin = StrokeJoin.Miter,
                strokeLineMiter = 1.0f,
                pathFillType = PathFillType.NonZero
            ) {
                moveTo(20f, 15.0714f)
                horizontalLineTo(16.5714f)
                verticalLineTo(18.5f)
                horizontalLineTo(15.4286f)
                verticalLineTo(15.0714f)
                horizontalLineTo(12f)
                verticalLineTo(13.9286f)
                horizontalLineTo(15.4286f)
                verticalLineTo(10.5f)
                horizontalLineTo(16.5714f)
                verticalLineTo(13.9286f)
                horizontalLineTo(20f)
                verticalLineTo(15.0714f)
                close()
            }
        }.build()
        return _Tassel_App_Icon!!
    }

private var _Tassel_App_Icon: ImageVector? = null