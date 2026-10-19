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


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	float t = iTime;
    vec2 q = fragCoord.xy / iResolution.xy;
    vec2 p = -1.0 + 2.0 * q;
    p.x *= iResolution.x/iResolution.y;
    

    // camera

    vec3 ro = vec3(2.);
   
    ro.yz*=rot(-1.5); 
    ro.y +=3.;
    ro.xz*=rot(0.1*t);
    
    vec3 ta = vec3( 0.0 , 0.0, 0.0 );
    vec3 ww = normalize( ta - ro );
    vec3 uu = normalize( cross(ww,vec3(0.0,1.0,0.0) ) );
    vec3 vv = normalize( cross(uu,ww));
    vec3 rd = normalize( p.x*uu + p.y*vv + 4.0*ww );
    ro.x -=t*.4;

	// raymarch 
    
    vec3 col = raycast(ro,rd);
    
	
	// shade
    
    col =  .5 *(log(1.+col));
    col = clamp(col,0.,1.);
    fragColor = vec4( col, 1.0 );

}
