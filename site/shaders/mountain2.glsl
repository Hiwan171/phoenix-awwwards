
// raymarching loop based on "[SH17A] Lava Planet" by P_Malin (https://www.shadertoy.com/view/ldBfDR)

#define T texture( iChannel0, u * .07 )

void mainImage( out vec4 Y, vec2 u )
{
    vec3 d = vec3( .45 * u / iResolution.y, 1 ) - .5, 
         p = d;
    
    float i = 0.,
          t = .1 * iTime;
    
    d /= d.y;
    u = .5 * d.xz - 3. * t;

    for ( Y = 3e2 * T; i++ < 1e3; u = p.xz - t )
        p = p.y < T.x ? Y += T, d * i / 1e3 : p;

    Y = Y / 8e1 + texture( iChannel1, u );
    u = 5. * ( u - t );
    Y += T + .3 * p.zzxz;
    Y *= Y * Y / 6e2;
}
