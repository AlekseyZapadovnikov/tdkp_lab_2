export class Complex {
    constructor(re, im) {
        this.re = re;
        this.im = im;
    }

    add(c) { return new Complex(this.re + c.re, this.im + c.im); }
    sub(c) { return new Complex(this.re - c.re, this.im - c.im); }
    mult(c) { return new Complex(this.re * c.re - this.im * c.im, this.re * c.im + this.im * c.re); }
    
    div(c) {
        const denom = c.re * c.re + c.im * c.im;
        if (denom === 0) return new Complex(Infinity, Infinity);
        return new Complex(
            (this.re * c.re + this.im * c.im) / denom,
            (this.im * c.re - this.re * c.im) / denom
        );
    }

    mod() { return Math.sqrt(this.re * this.re + this.im * this.im); }
    arg() { return Math.atan2(this.im, this.re); }

    // Корень 4-й степени
    sqrt4() {
        const r = this.mod();
        const phi = this.arg();
        const r_new = Math.pow(r, 0.25);
        const phi_new = phi / 4;
        return new Complex(r_new * Math.cos(phi_new), r_new * Math.sin(phi_new));
    }
}

// Константы
const I = new Complex(0, 1);
const ONE = new Complex(1, 0);

// Отображение w = i * ((iz) / (iz + 1))^(1/4)
export function mapZtoW(z) {
    // iz
    const iz = z.mult(I);
    // iz + 1
    const den = iz.add(ONE);
    
    // Проверка на деление на ноль (z = i - сингулярность)
    if (den.mod() < 0.0001) return null;

    // fraction = iz / (iz + 1)
    const frac = iz.div(den);
    
    // root = fraction^(1/4)
    const root = frac.sqrt4();
    
    // result = i * root
    return root.mult(I);
}