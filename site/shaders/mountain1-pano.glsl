// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
// Created by S. Guillitte 2021
 

mat2 rot(float a) {
	return mat2(cos(a),sin(a),-sin(a),cos(a));	
}

vec3 l = vec3(1.);

//Yonatan clouds/mountains combined field
vec2 field(in vec3 p) {
	
	float s=2.,e,f,o;
	
	for(e=f=p.y;s<8e2;s*=1.6)
            p.xz*=rot(s),
            e+=abs(dot(sin(p*s)/s,.4*l)),
            f+=abs(dot(sin(p.xz*s*.5)/s,l.xz));
	o = 1.+ (f>.001?e:-exp(-f*f));
    return vec2(max(o,0.),min(f,max(e,.07)));
}


vec3 raycast( in vec3 ro, vec3 rd )
{
    float t = 2.5;
    float dt = .035;
    vec3 col= vec3(0.);
    for( int i=0; i<100; i++ )
	{                
        vec2 v = field(ro+t*rd);  
        float c=v.x, f=v.y;
        t+=dt*f;
        dt *= 1.03;
        col = .95*col+ .09*vec3(c*c*c, c*c, c);	
    }
    
    return col;
}



// PANORAMA test (phoenix lab): equirectangular view from a fixed point. iMouse.x = camera height, iMouse.y = time offset
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 q = fragCoord.xy / iResolution.xy;
    float lon = (q.x - 0.5) * 6.2831853, lat = (q.y - 0.5) * 3.1415926;
    vec3 rd = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
    vec3 ro = vec3(-iMouse.y * 0.4, iMouse.x, 0.0);
    vec3 col = raycast(ro, rd);
    col = .5 * (log(1. + col));
    fragColor = vec4(clamp(col, 0., 1.), 1.0);
}
